const { spawn } = require('child_process');

function startVADProcess() {
  const proc = spawn('C:/Users/shubh/miniconda3/envs/vad-env/python.exe', ['vad.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
  return proc;
}

module.exports = { startVADProcess };



