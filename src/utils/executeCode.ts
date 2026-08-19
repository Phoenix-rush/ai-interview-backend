// File: backend/src/utils/executeCode.ts
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import util from 'util';

const execPromise = util.promisify(exec);

interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  verdict: string;
}

const LANGUAGE_CONFIG = {
  '54': { // C++
    filename: 'main.cpp',
    compileCmd: 'g++ main.cpp -o main',
    runCmd: './main'
  },
  '71': { // Python
    filename: 'main.py',
    compileCmd: '',
    runCmd: 'python3 main.py'
  },
  '63': { // JavaScript
    filename: 'main.js',
    compileCmd: '',
    runCmd: 'node main.js'
  },
  '62': { // Java
    filename: 'Main.java',
    compileCmd: 'javac Main.java',
    runCmd: 'java Main'
  }
};

export const runCodeInDocker = async (languageId: string, code: string, input: string = ''): Promise<ExecuteResult> => {
  const config = LANGUAGE_CONFIG[languageId as keyof typeof LANGUAGE_CONFIG];
  if (!config) {
    return { stdout: '', stderr: 'Language not supported', exitCode: -1, verdict: 'Error' };
  }

  const runId = crypto.randomUUID();
  const tempDir = path.join(__dirname, '../../temp_code', runId);

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, config.filename), code);
    await fs.writeFile(path.join(tempDir, 'input.txt'), input);

    // Compile if needed
    if (config.compileCmd) {
      try {
        await execPromise(config.compileCmd, { cwd: tempDir, timeout: 5000 });
      } catch (err: any) {
        return {
          stdout: '',
          stderr: err.stderr || err.message,
          exitCode: err.code || 99,
          verdict: 'Compilation Error'
        };
      }
    }

    // Run
    try {
      const { stdout, stderr } = await execPromise(`${config.runCmd} < input.txt`, { cwd: tempDir, timeout: 5000 });
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        verdict: 'Accepted'
      };
    } catch (err: any) {
      if (err.killed) {
        return { stdout: '', stderr: 'Execution timed out (5s limit)', exitCode: 124, verdict: 'Time Limit Exceeded' };
      }
      return {
        stdout: err.stdout ? err.stdout.trim() : '',
        stderr: err.stderr ? err.stderr.trim() : err.message,
        exitCode: err.code || 1,
        verdict: 'Runtime Error'
      };
    }
  } catch (err: any) {
    return { stdout: '', stderr: err.message, exitCode: -1, verdict: 'System Error' };
  } finally {
    // Cleanup temporary files
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to clean up temp dir', e);
    }
  }
};