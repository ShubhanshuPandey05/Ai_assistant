# import sys
# import torch
# import numpy as np
# import json
# from collections import deque

# # Load model
# model, utils = torch.hub.load('snakers4/silero-vad', model='silero_vad', trust_repo=True)
# (get_speech_timestamps, _, _, _, _) = utils

# # Constants
# sample_rate = 16000
# chunk_duration = 0.5  # seconds
# chunk_samples = int(sample_rate * chunk_duration)
# frame_bytes = chunk_samples * 2  # 16-bit PCM = 2 bytes per sample
# threshold = 0.6  # lower threshold for more sensitivity
# prefix_duration = 0.2  # 200ms
# prefix_samples = int(sample_rate * prefix_duration)
# prefix_buffer = deque(maxlen=prefix_samples)

# audio_buffer = bytearray()
# total_samples_processed = 0
# in_speech = False

# print("ready", file=sys.stderr)

# while True:
#     data = sys.stdin.buffer.read(1024)
#     if not data:
#         break

#     audio_buffer.extend(data)

#     while len(audio_buffer) >= frame_bytes:
#         chunk = audio_buffer[:frame_bytes]
#         audio_buffer = audio_buffer[frame_bytes:]

#         audio_np = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
#         prefix_buffer.extend(audio_np)

#         timestamps = get_speech_timestamps(
#             audio_np,
#             model,
#             sampling_rate=sample_rate,
#             threshold=threshold,
#             min_speech_duration_ms=100
#         )

#         if timestamps:
#             if not in_speech:
#                 in_speech = True
#                 prefix_np = np.array(prefix_buffer, dtype=np.float32)
#                 prefix_hex = (prefix_np * 32768.0).astype(np.int16).tobytes().hex()

#                 sys.stdout.write(json.dumps({
#                     'event': 'speech_start',
#                     'timestamps': [],
#                     'chunk': prefix_hex
#                 }) + "\n")
#                 sys.stdout.flush()

#             for ts in timestamps:
#                 ts['start'] += total_samples_processed
#                 ts['end'] += total_samples_processed

#             sys.stdout.write(json.dumps({
#                 'event': 'speech',
#                 'timestamps': timestamps,
#                 'chunk': chunk.hex()
#             }) + "\n")
#             sys.stdout.flush()

#         else:
#             # Fallback: if audio is loud enough, assume speech
#             if not in_speech and np.max(np.abs(audio_np)) > 0.2:
#                 in_speech = True
#                 sys.stdout.write(json.dumps({
#                     'event': 'manual_speech_trigger',
#                     'chunk': chunk.hex()
#                 }) + "\n")
#                 sys.stdout.flush()
#             elif in_speech:
#                 in_speech = False
#                 sys.stdout.write(json.dumps({'event': 'speech_end'}) + "\n")
#                 sys.stdout.flush()

#         total_samples_processed += len(audio_np)

# # Final flush if needed
# if len(audio_buffer) >= frame_bytes:
#     chunk = audio_buffer[:frame_bytes]
#     audio_np = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
#     timestamps = get_speech_timestamps(audio_np, model, sampling_rate=sample_rate, threshold=threshold)
#     for ts in timestamps:
#         ts['start'] += total_samples_processed
#         ts['end'] += total_samples_processed
#     sys.stdout.write(json.dumps({'event': 'speech', 'timestamps': timestamps, 'chunk': chunk.hex()}) + "\n")
#     sys.stdout.flush()



import sys
import torch
import numpy as np
import json
from collections import deque

# Load model
model, utils = torch.hub.load('snakers4/silero-vad', model='silero_vad', trust_repo=True)
(get_speech_timestamps, _, _, _, _) = utils

# Constants
sample_rate = 16000
min_chunk_samples = sample_rate // 4  # 0.5 seconds = 8000 samples
frame_bytes = min_chunk_samples * 4  # 16-bit PCM = 2 bytes per sample
threshold = 0.6
prefix_duration = 0.1  # 200ms
prefix_samples = int(sample_rate * prefix_duration)
prefix_buffer = deque(maxlen=prefix_samples)

audio_buffer = bytearray()
total_samples_processed = 0
in_speech = False

print("ready", file=sys.stderr)

while True:
    data = sys.stdin.buffer.read(1024)
    if not data:
        break

    audio_buffer.extend(data)

    while len(audio_buffer) >= frame_bytes:
        chunk = audio_buffer[:frame_bytes]
        audio_buffer = audio_buffer[frame_bytes:]

        audio_np = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0

        # Maintain prefix buffer (older audio)
        prefix_buffer.extend(audio_np)

        timestamps = get_speech_timestamps(audio_np, model, sampling_rate=sample_rate, threshold=threshold)

        if timestamps:
            # First time speech detected: prepend prefix audio
            if not in_speech:
                in_speech = True
                prefix_np = np.array(prefix_buffer, dtype=np.float32)
                prefix_hex = (prefix_np * 32768.0).astype(np.int16).tobytes().hex()

                sys.stdout.write(json.dumps({
                    'event': 'speech_start',
                    'timestamps': [],
                    'chunk': prefix_hex
                }) + "\n")
                sys.stdout.flush()

            # Adjust timestamps to global position
            for ts in timestamps:
                ts['start'] += total_samples_processed
                ts['end'] += total_samples_processed

            sys.stdout.write(json.dumps({
                'event': 'speech',
                'timestamps': timestamps,
                'chunk': chunk.hex()
            }) + "\n")
            sys.stdout.flush()

        else:
            if in_speech:
                in_speech = False
                sys.stdout.write(json.dumps({'event': 'speech_end'}) + "\n")
                sys.stdout.flush()

        total_samples_processed += len(audio_np)

# Optional: handle remaining buffer
if len(audio_buffer) >= frame_bytes:
    chunk = audio_buffer[:frame_bytes]
    audio_np = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
    timestamps = get_speech_timestamps(audio_np, model, sampling_rate=sample_rate, threshold=threshold)
    for ts in timestamps:
        ts['start'] += total_samples_processed
        ts['end'] += total_samples_processed
    sys.stdout.write(json.dumps({'event': 'speech', 'timestamps': timestamps, 'chunk': chunk.hex()}) + "\n")
    sys.stdout.flush()