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
min_chunk_samples = sample_rate // 4  # 0.5 seconds = 4000 samples
frame_bytes = min_chunk_samples * 4  # 16-bit PCM = 2 bytes per sample
threshold = 0.5
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




# #!/usr/bin/env python3
# # --------------------------------------------------------------------
# #  🎙  48 kHz  →  16 kHz   VAD bridge for Silero
# #  • Input : 48 000 Hz, mono, 16-bit PCM, *any* chunk length
# #            (denoiser gives 480-sample / 960-byte frames, but we’ll
# #             happily receive arbitrary multiples)
# #  • Output: JSON lines identical to your previous script
# # --------------------------------------------------------------------
# import sys
# import torch
# import numpy as np
# import json
# from collections import deque

# # ────────────────────────── Silero VAD ──────────────────────────────
# model, utils = torch.hub.load('snakers4/silero-vad',
#                               model='silero_vad',
#                               trust_repo=True)
# (get_speech_timestamps, _, _, _, _) = utils

# # ─────────────────────────── Constants ──────────────────────────────
# IN_SR   = 48_000          # denoiser output sample-rate
# VAD_SR  = 16_000          # Silero works at 8k / 16k / 32k
# CHUNK_SEC  = 0.25         # process every 250 ms
# CHUNK_SMP  = int(IN_SR * CHUNK_SEC)       # 12 000 samples
# CHUNK_BYTES = CHUNK_SMP * 2               # int16 → 2 bytes
# THRESHOLD = 0.6

# PREFIX_SEC = 0.1                          # 100 ms look-back
# PREFIX_SMP = int(VAD_SR * PREFIX_SEC)     # 1600 samples @16k
# prefix_buffer = deque(maxlen=PREFIX_SMP)  # stores **resampled** audio

# audio_buf  = bytearray()
# total_smp_processed = 0
# in_speech = False

# print("ready", file=sys.stderr)

# # ───────────────────────── Helper: 48k → 16k ───────────────────────
# def downsample_48k_to_16k(x: np.ndarray) -> np.ndarray:
#     """
#     Cheap linear-phase decimator: take every 3rd sample average.
#     Good enough for VAD; avoids torchaudio dependency.
#     """
#     x = x.reshape(-1, 3)                  # [N / 3 , 3]
#     return x.mean(axis=1)

# # ──────────────────────────── Main Loop ────────────────────────────
# while True:
#     data = sys.stdin.buffer.read(1024)
#     if not data:
#         break

#     audio_buf.extend(data)

#     # process in 250 ms blocks (or whatever CHUNK_SEC is)
#     while len(audio_buf) >= CHUNK_BYTES:
#         block = audio_buf[:CHUNK_BYTES]
#         audio_buf = audio_buf[CHUNK_BYTES:]

#         # -------- int16 → float32 @48 kHz --------------------------
#         pcm48 = np.frombuffer(block, dtype=np.int16).astype(np.float32) / 32768.0

#         # -------- ↓↓↓   resample to 16 kHz   ↓↓↓ -------------------
#         pcm16 = downsample_48k_to_16k(pcm48)               # float32
#         prefix_buffer.extend(pcm16)                        # keep look-back

#         # -------- VAD ---------------------------------------------
#         ts_list = get_speech_timestamps(pcm16,
#                                         model,
#                                         sampling_rate=VAD_SR,
#                                         threshold=THRESHOLD)

#         if ts_list:                                        # speech present
#             if not in_speech:                              # 1st frame
#                 in_speech = True
#                 pre_np = np.array(prefix_buffer, dtype=np.float32)
#                 pre_hex = (pre_np * 32768.0)\
#                           .astype(np.int16)\
#                           .tobytes()\
#                           .hex()
#                 sys.stdout.write(json.dumps({
#                     'event': 'speech_start',
#                     'timestamps': [],
#                     'chunk': pre_hex
#                 }) + '\n')
#                 sys.stdout.flush()

#             # adjust timestamps to stream-wide sample index (*at 16 kHz*)
#             for ts in ts_list:
#                 ts['start'] += total_smp_processed
#                 ts['end']   += total_smp_processed

#             chunk_hex = (pcm16 * 32768.0)\
#                         .astype(np.int16)\
#                         .tobytes()\
#                         .hex()

#             sys.stdout.write(json.dumps({
#                 'event': 'speech',
#                 'timestamps': ts_list,
#                 'chunk': chunk_hex
#             }) + '\n')
#             sys.stdout.flush()

#         else:                                              # no speech
#             if in_speech:
#                 in_speech = False
#                 sys.stdout.write(json.dumps({'event': 'speech_end'}) + '\n')
#                 sys.stdout.flush()

#         total_smp_processed += len(pcm16)                  # 16 kHz samples

# # ───────────────────── flush any leftover frames ───────────────────
# if audio_buf:
#     pcm48 = np.frombuffer(audio_buf, dtype=np.int16)\
#              .astype(np.float32) / 32768.0
#     pcm16 = downsample_48k_to_16k(pcm48)
#     ts_list = get_speech_timestamps(pcm16,
#                                     model,
#                                     sampling_rate=VAD_SR,
#                                     threshold=THRESHOLD)
#     if ts_list:
#         chunk_hex = (pcm16 * 32768.0).astype(np.int16).tobytes().hex()
#         sys.stdout.write(json.dumps({
#             'event': 'speech',
#             'timestamps': ts_list,
#             'chunk': chunk_hex
#         }) + '\n')
#         sys.stdout.flush()