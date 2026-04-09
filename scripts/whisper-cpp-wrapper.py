#!/usr/bin/env python3
"""
whisper-cpp wrapper script for EchOS local STT.
Uses the whispercpp Python package to transcribe audio files.

Usage:
    whisper-cpp-wrapper.py -m MODEL -f AUDIO_FILE [-l LANGUAGE] [-o OUTPUT_DIR]

Expects:
    -m <model_name>   Model name (e.g., base.en, small, medium, large)
    -f <audio_file>   Path to audio file (WAV, 16kHz, mono preferred)
    -l <language>     Optional language code (e.g., en, ru, he)
    -o <output_dir>   Optional output directory for .txt file (default: same dir as audio)

Output:
    Writes <audio_file>.txt with the transcription text.
    Exits with code 0 on success, non-zero on failure.
"""

import sys
import os
import struct
import wave
import argparse


def main():
    parser = argparse.ArgumentParser(description="Whisper.cpp wrapper for EchOS")
    parser.add_argument("-m", "--model", required=True, help="Model name")
    parser.add_argument("-f", "--file", required=True, help="Audio file path (WAV)")
    parser.add_argument("-l", "--language", default=None, help="Language code")
    parser.add_argument("-o", "--output-dir", default=None, help="Output directory")
    args = parser.parse_args()

    # Import whispercpp
    try:
        from whispercpp import Whisper
    except ImportError:
        print(
            "Error: whispercpp package not found. Install with: pip install whispercpp",
            file=sys.stderr,
        )
        sys.exit(1)

    # Load model
    model_name = args.model.replace(".bin", "").replace("ggml-", "")
    model_dir = os.environ.get(
        "WHISPER_MODEL_DIR",
        os.path.join(os.path.expanduser("~"), ".local", "share", "whispercpp"),
    )
    try:
        w = Whisper.from_pretrained(model_name, basedir=model_dir)
    except Exception as e:
        print(f"Error loading model '{model_name}': {e}", file=sys.stderr)
        sys.exit(1)

    # Set language if specified
    if args.language:
        w.params.language = args.language

    # Read WAV file and convert to float samples
    audio_path = args.file
    try:
        with wave.open(audio_path, "rb") as wf:
            n_frames = wf.getnframes()
            raw = wf.readframes(n_frames)
            samples = struct.unpack(f"<{n_frames}h", raw)
            float_samples = [s / 32768.0 for s in samples]
    except Exception as e:
        print(f"Error reading audio file: {e}", file=sys.stderr)
        sys.exit(1)

    # Transcribe
    try:
        result_code = w.context.full_parallel(w.params, float_samples, 1)
        if result_code != 0:
            print(f"Transcription failed with code {result_code}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"Error transcribing: {e}", file=sys.stderr)
        sys.exit(1)

    # Extract text from segments
    n_segments = w.context.full_n_segments()
    text_parts = []
    for i in range(n_segments):
        segment_text = w.context.full_get_segment_text(i)
        if segment_text:
            text_parts.append(segment_text)

    text = " ".join(text_parts).strip()

    # Write output
    output_dir = args.output_dir or os.path.dirname(audio_path) or "."
    output_path = os.path.join(output_dir, os.path.basename(audio_path) + ".txt")
    try:
        with open(output_path, "w") as f:
            f.write(text)
    except Exception as e:
        print(f"Error writing output: {e}", file=sys.stderr)
        sys.exit(1)

    print(text)


if __name__ == "__main__":
    main()
