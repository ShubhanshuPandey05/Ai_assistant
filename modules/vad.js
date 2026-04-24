const { spawn } = require('child_process');

const PYTHON_BIN = process.env.PYTHON_PATH || 'python3';

function startVADProcess() {
  // const proc = spawn('D:/work/ship-fast.studio/Ai-Assistant/python_env/Scripts/python.exe', ['vad.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const proc = spawn(PYTHON_BIN, ['vad.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
  return proc;
}

module.exports = { startVADProcess };