// Builds dist/FAU-Campus-3D.exe: a tiny Windows launcher (C#, compiled with the .NET Framework
// compiler that ships with Windows) with the offline HTML embedded as a resource.
// Usage: node build.mjs && node tools/build-exe.mjs
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const win = process.env.WINDIR || 'C:\\Windows';
const csc = [join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find(existsSync);
if (!csc) { console.error('csc.exe (.NET Framework 4) not found – this step needs Windows'); process.exit(1); }
const html = resolve('dist', 'FAU-Campus.html');
if (!existsSync(html)) { console.error('run "node build.mjs" first'); process.exit(1); }
const out = resolve('dist', 'FAU-Campus-3D.exe');
execFileSync(csc, [
  '/nologo', '/target:winexe', '/optimize+', `/out:${out}`,
  `/win32icon:${resolve('desktop', 'icon.ico')}`,
  `/resource:${html},FAU-Campus.html`,
  '/reference:System.Windows.Forms.dll',
  resolve('desktop', 'Launcher.cs'),
], { stdio: 'inherit' });
console.log(`dist/FAU-Campus-3D.exe  ${(statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
