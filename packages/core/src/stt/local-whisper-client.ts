import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpeechToTextClient, TranscribeOptions, TranscribeResult } from './index.js';

function spawnAsync(
  command: string,
  args: string[],
  shell = false,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr}`));
    });
    child.on('error', reject);
  });
}

/**
 * Local Whisper client for offline speech-to-text.
 *
 * Supports multiple Whisper implementations:
 * - whisper.cpp CLI (whisper-cli, main)
 * - whispercpp Python package (via wrapper script)
 * - openai-whisper Python package (official OpenAI Whisper)
 * - faster-whisper Python package (CTranslate2-based)
 *
 * Configuration examples:
 * - whisper.cpp: STT_LOCAL_COMMAND=whisper-cli
 * - whispercpp:  STT_LOCAL_COMMAND="python /path/to/whisper-cpp-wrapper.py"
 * - openai-whisper: STT_LOCAL_COMMAND="whisper --model base.en --output_format txt"
 * - faster-whisper: STT_LOCAL_COMMAND="python -m faster_whisper --model base.en"
 */
export class LocalWhisperClient implements SpeechToTextClient {
  private whisperType: 'whisper-cpp' | 'whispercpp-python' | 'openai-whisper' | 'faster-whisper' | 'generic';

  constructor(
    private command: string,
    private model: string, // Full path to model file, or model name for Python packages
  ) {
    this.whisperType = this.detectWhisperType(command);
  }

  private detectWhisperType(command: string): LocalWhisperClient['whisperType'] {
    const normalized = command.toLowerCase().trim();

    // Check for Python-based implementations
    if (normalized.includes('python') || normalized.endsWith('.py')) {
      // Check for whispercpp Python package wrapper
      if (normalized.includes('whisper-cpp-wrapper') || normalized.includes('whispercpp')) {
        return 'whispercpp-python';
      }
      // Check for faster-whisper
      if (normalized.includes('faster_whisper') || normalized.includes('faster-whisper')) {
        return 'faster-whisper';
      }
      // Generic Python command
      return 'generic';
    }

    // Check for openai-whisper CLI (official OpenAI Whisper package)
    if (normalized.includes('whisper ') || normalized === 'whisper') {
      return 'openai-whisper';
    }

    // Check for whisper.cpp CLI
    if (
      normalized.includes('whisper-cli') ||
      normalized.includes('main') ||
      normalized.includes('whisper.cpp')
    ) {
      return 'whisper-cpp';
    }

    // Default to generic
    return 'generic';
  }

  async transcribe({
    audioBuffer,
    mimeType,
    language,
  }: TranscribeOptions): Promise<TranscribeResult> {
    const start = Date.now();
    const baseName = `echos-stt-${randomUUID()}`;
    const tmpPath = join(tmpdir(), baseName);

    try {
      let audioPath: string;

      if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') {
        audioPath = `${tmpPath}.wav`;
        await writeFile(audioPath, audioBuffer);
      } else {
        const inputPath = `${tmpPath}.input`;
        await writeFile(inputPath, audioBuffer);
        audioPath = `${tmpPath}.wav`;
        await spawnAsync('ffmpeg', [
          '-i',
          inputPath,
          '-ar',
          '16000',
          '-ac',
          '1',
          '-f',
          'wav',
          audioPath,
        ]);
        await unlink(inputPath).catch(() => undefined);
      }

      const text = await this.runTranscription(audioPath, language);

      return { text: text.trim(), provider: `local/${this.model}`, duration: Date.now() - start };
    } finally {
      const files = [`${tmpPath}.input`, `${tmpPath}.wav`, `${tmpPath}.wav.txt`];
      for (const f of files) {
        try {
          await unlink(f);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async runTranscription(audioPath: string, language?: string): Promise<string> {
    switch (this.whisperType) {
      case 'whispercpp-python':
        return this.runWhisperCppPython(audioPath, language);
      case 'openai-whisper':
        return this.runOpenAiWhisper(audioPath, language);
      case 'faster-whisper':
        return this.runFasterWhisper(audioPath, language);
      case 'whisper-cpp':
        return this.runWhisperCpp(audioPath, language);
      case 'generic':
      default:
        return this.runGenericCommand(audioPath, language);
    }
  }

  /**
   * Run whispercpp Python package via wrapper script.
   * Command: python /path/to/whisper-cpp-wrapper.py
   */
  private async runWhisperCppPython(audioPath: string, language?: string): Promise<string> {
    const parts = this.command.trim().split(/\s+/);
    const cmd = parts[0]!;
    const scriptArgs = parts.slice(1);
    const args = [...scriptArgs, '-f', audioPath];
    if (this.model) args.push('-m', this.model);
    if (language) args.push('-l', language);
    const { stdout } = await spawnAsync(cmd, args);
    return stdout.trim();
  }

  /**
   * Run official OpenAI Whisper Python package.
   * Command: whisper --model base.en --output_format txt
   */
  private async runOpenAiWhisper(audioPath: string, language?: string): Promise<string> {
    const parts = this.command.trim().split(/\s+/);
    const cmd = parts[0]!;
    const baseArgs = parts.slice(1);

    const args = [...baseArgs];
    // Add model if not already specified
    if (!baseArgs.some((a) => a.startsWith('--model') || a.startsWith('-m'))) {
      args.push('--model', this.model);
    }
    // Ensure output format is text
    if (!baseArgs.includes('--output_format')) {
      args.push('--output_format', 'txt');
    }
    // Add language if specified
    if (language && !baseArgs.includes('--language')) {
      args.push('--language', language);
    }
    // Add audio file
    args.push(audioPath);

    const { stdout } = await spawnAsync(cmd, args);
    return stdout.trim();
  }

  /**
   * Run faster-whisper Python package.
   * Command: python -m faster_whisper --model base.en
   */
  private async runFasterWhisper(audioPath: string, language?: string): Promise<string> {
    const parts = this.command.trim().split(/\s+/);
    const cmd = parts[0]!;
    const baseArgs = parts.slice(1);

    const args = [...baseArgs];
    // Add model if not already specified
    if (!baseArgs.some((a) => a.startsWith('--model') || a.startsWith('-m'))) {
      args.push('--model', this.model);
    }
    // Add language if specified
    if (language && !baseArgs.includes('--language')) {
      args.push('--language', language);
    }
    // Add audio file
    args.push(audioPath);

    const { stdout } = await spawnAsync(cmd, args);
    return stdout.trim();
  }

  /**
   * Run whisper.cpp CLI (whisper-cli, main).
   * Command: whisper-cli or /path/to/main
   */
  private async runWhisperCpp(audioPath: string, language?: string): Promise<string> {
    const args = ['-m', this.model, '-f', audioPath, '-otxt'];
    if (language) args.push('-l', language);

    await spawnAsync(this.command, args);

    const txtPath = `${audioPath}.txt`;
    return (await readFile(txtPath, 'utf-8')).trim();
  }

  /**
   * Run a generic command with the audio file path.
   * The command should output transcription to stdout.
   */
  private async runGenericCommand(audioPath: string, language?: string): Promise<string> {
    const parts = this.command.trim().split(/\s+/);
    const cmd = parts[0]!;
    const baseArgs = parts.slice(1);

    const args = [...baseArgs, audioPath];
    if (language) args.push('--language', language);

    const { stdout } = await spawnAsync(cmd, args);
    return stdout.trim();
  }
}
