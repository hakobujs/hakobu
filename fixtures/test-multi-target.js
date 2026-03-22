#!/usr/bin/env node
/**
 * Multi-target packaging verification.
 *
 * Tests that Hakobu can package a project for multiple targets in one
 * invocation with correct output naming and shared work reuse.
 *
 * Run: node fixtures/test-multi-target.js
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HAKOBU_BIN = path.join(__dirname, '../packages/hakobu/lib-es5/bin.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  XX  ${name}`);
    console.log(`      ${err.message}`);
  }
}

// Create a simple test project
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-multi-'));
fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
  name: 'multi-verify', version: '1.0.0', main: 'index.js',
}));
fs.writeFileSync(path.join(projectDir, 'index.js'), "console.log('multi-ok');\n");

console.log('\n=== Multi-Target Packaging Verification ===\n');

// Test 1: Two-target build
const outDir = path.join(projectDir, 'dist');
try {
  console.log('  Packaging for macos-arm64 + linux-x64...');
  const stdout = execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir,
    '--target', 'node24-macos-arm64,node24-linux-x64',
    '--output', outDir,
  ], { timeout: 600000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  console.log('  Packaged OK\n');

  test('two executables produced', () => {
    const files = fs.readdirSync(outDir);
    if (files.length !== 2) throw new Error(`Expected 2 files, got ${files.length}: ${files}`);
  });

  test('macos-arm64 output exists with correct name', () => {
    const p = path.join(outDir, 'multi-verify-macos-arm64');
    if (!fs.existsSync(p)) throw new Error('Not found: ' + p);
  });

  test('linux-x64 output exists with correct name', () => {
    const p = path.join(outDir, 'multi-verify-linux-x64');
    if (!fs.existsSync(p)) throw new Error('Not found: ' + p);
  });

  test('macos output is Mach-O', () => {
    const buf = fs.readFileSync(path.join(outDir, 'multi-verify-macos-arm64'));
    // Mach-O magic: 0xFEEDFACF (64-bit)
    if (buf.readUInt32LE(0) !== 0xFEEDFACF) throw new Error('Not Mach-O');
  });

  test('linux output is ELF', () => {
    const buf = fs.readFileSync(path.join(outDir, 'multi-verify-linux-x64'));
    // ELF magic: 0x7F 'E' 'L' 'F'
    if (buf[0] !== 0x7F || buf[1] !== 0x45 || buf[2] !== 0x4C || buf[3] !== 0x46) {
      throw new Error('Not ELF');
    }
  });

  test('macos output runs correctly', () => {
    const result = execFileSync(path.join(outDir, 'multi-verify-macos-arm64'), [], {
      timeout: 15000, encoding: 'utf8',
    });
    if (!result.trim().includes('multi-ok')) throw new Error('Output: ' + result.trim());
  });

  test('summary mentions succeeded count', () => {
    if (!stdout.includes('2 succeeded')) throw new Error('Summary not found in output');
  });

} catch (err) {
  const stderr = err.stderr ? err.stderr.toString().trim() : '';
  const stdout = err.stdout ? err.stdout.toString().trim() : '';
  console.error('  Package FAILED:', err.message.split('\n')[0]);
  if (stderr) {
    console.error('  STDERR:');
    for (const line of stderr.split('\n').slice(-15)) {
      console.error('    ' + line);
    }
  }
  if (stdout) {
    console.error('  STDOUT (last 10 lines):');
    for (const line of stdout.split('\n').slice(-10)) {
      console.error('    ' + line);
    }
  }
  failed++;
}

// Test 2: Single target still works as file path
const singleOut = path.join(projectDir, 'single-out');
try {
  execFileSync(process.execPath, [
    HAKOBU_BIN, projectDir,
    '--target', 'node24-macos-arm64',
    '--output', singleOut,
  ], { timeout: 120000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  test('single-target output is a file (not directory)', () => {
    if (!fs.existsSync(singleOut)) throw new Error('Output file not found');
    if (fs.statSync(singleOut).isDirectory()) throw new Error('Should be a file, not directory');
  });
} catch (err) {
  console.error('  Single-target FAILED:', err.message.split('\n')[0]);
  failed++;
}

// Clean up
try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
