import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { ProcessingError } from '@echos/shared';
import type { SpeechToTextClient, TranscribeOptions, TranscribeResult } from './index.js';

function spawnAsync(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
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

export class LocalWhisperClient implements SpeechToTextClient {
  constructor(
    private command: string,
    private model: string,
    private modelDir?: string,
  ) {}

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

      const modelPath = `${this.modelDir ?? '/usr/local/share/whisper.cpp/models'}/${this.model}.bin`;
      const args = ['-m', modelPath, '-f', audioPath, '-otxt'];
      if (language) args.push('-l', language);

      await spawnAsync(this.command, args);

      const txtPath = `${audioPath}.txt`;
      const text = await readFile(txtPath, 'utf-8');

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
}
