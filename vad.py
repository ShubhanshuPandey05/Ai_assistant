import sys
import torch
import numpy as np
import json
import logging
import argparse
from collections import deque
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import time

@dataclass
class VADConfig:
    """Configuration for VAD system"""
    sample_rate: int = 16000
    chunk_duration: float = 0.25  # seconds
    threshold: float = 0.5
    prefix_duration: float = 0.1  # seconds
    suffix_duration: float = 0.1  # seconds
    min_speech_duration: float = 0.1  # minimum speech segment length
    min_silence_duration: float = 0.3  # minimum silence to end speech
    read_size: int = 4096  # larger reads for better performance
    
    def __post_init__(self):
        self.chunk_samples = int(self.sample_rate * self.chunk_duration)
        self.frame_bytes = self.chunk_samples * 2  # 16-bit PCM
        self.prefix_samples = int(self.sample_rate * self.prefix_duration)
        self.suffix_samples = int(self.sample_rate * self.suffix_duration)
        self.min_speech_samples = int(self.sample_rate * self.min_speech_duration)
        self.min_silence_samples = int(self.sample_rate * self.min_silence_duration)

class ImprovedVAD:
    def __init__(self, config: VADConfig):
        self.config = config
        self.setup_logging()
        self.load_model()
        self.reset_state()
        
    def setup_logging(self):
        """Setup logging to stderr"""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            stream=sys.stderr
        )
        self.logger = logging.getLogger(__name__)
        
    def load_model(self):
        """Load Silero VAD model with error handling"""
        try:
            self.logger.info("Loading Silero VAD model...")
            self.model, utils = torch.hub.load(
                'snakers4/silero-vad', 
                model='silero_vad', 
                trust_repo=True,
                verbose=False
            )
            self.get_speech_timestamps = utils[0]
            
            # Optimize model for inference
            self.model.eval()
            if torch.cuda.is_available():
                self.model = self.model.cuda()
                self.logger.info("Using CUDA acceleration")
            else:
                self.model = self.model.cpu()
                
            self.logger.info("Model loaded successfully")
        except Exception as e:
            self.logger.error(f"Failed to load model: {e}")
            sys.exit(1)
            
    def reset_state(self):
        """Reset internal state"""
        self.audio_buffer = bytearray()
        self.prefix_buffer = deque(maxlen=self.config.prefix_samples)
        self.suffix_buffer = deque(maxlen=self.config.suffix_samples)
        self.total_samples_processed = 0
        self.in_speech = False
        self.speech_start_sample = 0
        self.silence_samples = 0
        self.current_speech_samples = 0
        
    def bytes_to_float32(self, audio_bytes: bytes) -> np.ndarray:
        """Convert 16-bit PCM bytes to normalized float32"""
        return np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        
    def float32_to_bytes(self, audio_float: np.ndarray) -> bytes:
        """Convert normalized float32 to 16-bit PCM bytes"""
        return (audio_float * 32768.0).astype(np.int16).tobytes()
        
    def detect_speech_in_chunk(self, audio_np: np.ndarray) -> List[Dict]:
        """Detect speech in audio chunk with error handling"""
        try:
            # Move to GPU if available
            if torch.cuda.is_available():
                audio_tensor = torch.from_numpy(audio_np).cuda()
            else:
                audio_tensor = torch.from_numpy(audio_np)
                
            with torch.no_grad():
                timestamps = self.get_speech_timestamps(
                    audio_tensor,
                    self.model,
                    sampling_rate=self.config.sample_rate,
                    threshold=self.config.threshold,
                    min_speech_duration_ms=int(self.config.min_speech_duration * 1000),
                    min_silence_duration_ms=int(self.config.min_silence_duration * 1000)
                )
            return timestamps
        except Exception as e:
            self.logger.error(f"Error in speech detection: {e}")
            return []
            
    def emit_event(self, event_type: str, timestamps: List[Dict] = None, 
                   chunk: Optional[bytes] = None, metadata: Dict = None):
        """Emit JSON event with error handling"""
        try:
            event = {
                'event': event_type,
                'timestamp': time.time(),
                'sample_position': self.total_samples_processed
            }
            
            if timestamps:
                event['timestamps'] = timestamps
            if chunk:
                event['chunk'] = chunk.hex()
            if metadata:
                event.update(metadata)
                
            sys.stdout.write(json.dumps(event) + "\n")
            sys.stdout.flush()
        except Exception as e:
            self.logger.error(f"Error emitting event: {e}")
            
    def handle_speech_start(self, audio_np: np.ndarray, timestamps: List[Dict]):
        """Handle start of speech detection"""
        self.in_speech = True
        self.speech_start_sample = self.total_samples_processed
        self.current_speech_samples = len(audio_np)
        self.silence_samples = 0
        
        # Create prefix audio from buffer
        prefix_audio = np.array(list(self.prefix_buffer), dtype=np.float32)
        combined_audio = np.concatenate([prefix_audio, audio_np])
        
        # Adjust timestamps for prefix
        adjusted_timestamps = []
        for ts in timestamps:
            adjusted_ts = ts.copy()
            adjusted_ts['start'] += len(prefix_audio)
            adjusted_ts['end'] += len(prefix_audio)
            adjusted_timestamps.append(adjusted_ts)
            
        self.emit_event(
            'speech_start',
            adjusted_timestamps,
            self.float32_to_bytes(combined_audio),
            {'prefix_samples': len(prefix_audio)}
        )
        
    def handle_speech_continue(self, audio_np: np.ndarray, timestamps: List[Dict]):
        """Handle continuation of speech"""
        self.current_speech_samples += len(audio_np)
        self.silence_samples = 0
        
        # Adjust timestamps to global position
        for ts in timestamps:
            ts['start'] += self.total_samples_processed
            ts['end'] += self.total_samples_processed
            
        self.emit_event(
            'speech_continue',
            timestamps,
            self.float32_to_bytes(audio_np)
        )
        
    def handle_speech_end(self):
        """Handle end of speech detection"""
        if self.current_speech_samples >= self.config.min_speech_samples:
            # Add suffix audio for natural ending
            suffix_audio = np.array(list(self.suffix_buffer), dtype=np.float32)
            
            self.emit_event(
                'speech_end',
                metadata={
                    'speech_duration_samples': self.current_speech_samples,
                    'speech_duration_seconds': self.current_speech_samples / self.config.sample_rate,
                    'suffix_samples': len(suffix_audio)
                }
            )
            
            if len(suffix_audio) > 0:
                self.emit_event(
                    'speech_suffix',
                    chunk=self.float32_to_bytes(suffix_audio)
                )
        
        self.in_speech = False
        self.current_speech_samples = 0
        
    def process_chunk(self, audio_np: np.ndarray):
        """Process a single audio chunk"""
        # Update buffers
        self.prefix_buffer.extend(audio_np)
        if self.in_speech:
            self.suffix_buffer.extend(audio_np)
            
        # Detect speech
        timestamps = self.detect_speech_in_chunk(audio_np)
        
        if timestamps:
            if not self.in_speech:
                self.handle_speech_start(audio_np, timestamps)
            else:
                self.handle_speech_continue(audio_np, timestamps)
        else:
            # No speech detected
            if self.in_speech:
                self.silence_samples += len(audio_np)
                # End speech if silence duration exceeded
                if self.silence_samples >= self.config.min_silence_samples:
                    self.handle_speech_end()
                    
        self.total_samples_processed += len(audio_np)
        
    def process_remaining_buffer(self):
        """Process any remaining audio in buffer"""
        if len(self.audio_buffer) >= 2:  # At least one sample
            # Pad to chunk size if needed
            remaining_bytes = len(self.audio_buffer)
            if remaining_bytes < self.config.frame_bytes:
                padding = self.config.frame_bytes - remaining_bytes
                self.audio_buffer.extend(b'\x00' * padding)
                
            chunk = bytes(self.audio_buffer[:self.config.frame_bytes])
            audio_np = self.bytes_to_float32(chunk)
            self.process_chunk(audio_np)
            
        # Final speech end if still in speech
        if self.in_speech:
            self.handle_speech_end()
            
    def run(self):
        """Main processing loop"""
        self.logger.info("VAD system ready")
        self.emit_event('system_ready', metadata={'config': self.config.__dict__})
        
        try:
            while True:
                data = sys.stdin.buffer.read(self.config.read_size)
                if not data:
                    break
                    
                self.audio_buffer.extend(data)
                
                # Process complete chunks
                while len(self.audio_buffer) >= self.config.frame_bytes:
                    chunk = bytes(self.audio_buffer[:self.config.frame_bytes])
                    self.audio_buffer = self.audio_buffer[self.config.frame_bytes:]
                    
                    audio_np = self.bytes_to_float32(chunk)
                    self.process_chunk(audio_np)
                    
        except KeyboardInterrupt:
            self.logger.info("Interrupted by user")
        except Exception as e:
            self.logger.error(f"Unexpected error: {e}")
        finally:
            self.process_remaining_buffer()
            self.emit_event('system_shutdown')
            self.logger.info("VAD system shutdown")

def main():
    parser = argparse.ArgumentParser(description='Improved Voice Activity Detection System')
    parser.add_argument('--sample-rate', type=int, default=16000, help='Audio sample rate')
    parser.add_argument('--threshold', type=float, default=0.5, help='VAD threshold')
    parser.add_argument('--chunk-duration', type=float, default=0.25, help='Chunk duration in seconds')
    parser.add_argument('--min-speech', type=float, default=0.1, help='Minimum speech duration')
    parser.add_argument('--min-silence', type=float, default=0.3, help='Minimum silence duration')
    parser.add_argument('--prefix-duration', type=float, default=0.1, help='Prefix duration')
    parser.add_argument('--suffix-duration', type=float, default=0.1, help='Suffix duration')
    
    args = parser.parse_args()
    
    config = VADConfig(
        sample_rate=args.sample_rate,
        threshold=args.threshold,
        chunk_duration=args.chunk_duration,
        min_speech_duration=args.min_speech,
        min_silence_duration=args.min_silence,
        prefix_duration=args.prefix_duration,
        suffix_duration=args.suffix_duration
    )
    
    vad = ImprovedVAD(config)
    vad.run()

if __name__ == "__main__":
    main()