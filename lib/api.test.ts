import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBase } from './api.ts';

void test('browser LAN HTTP must match the current private origin; native HTTP exceptions are opt-in', () => {
  const lan = 'http://192.168.50.20:8787';
  assert.equal(normalizeBase(`${lan}/`, lan), lan);
  assert.equal(
    normalizeBase('http://10.0.0.2', 'http://10.0.0.2'),
    'http://10.0.0.2',
  );
  assert.equal(
    normalizeBase('http://172.16.0.2', 'http://172.16.0.2'),
    'http://172.16.0.2',
  );
  assert.throws(() => normalizeBase(lan, 'https://car.example.com'));
  assert.throws(() => normalizeBase(lan, 'capacitor://localhost'));
  assert.throws(() => normalizeBase(lan, 'https://localhost'));
  assert.throws(() => normalizeBase(lan, 'http://192.168.1.11:8787'));
  assert.throws(() => normalizeBase(lan, 'http://192.168.50.20:3000'));
  assert.throws(() => normalizeBase('http://172.32.0.2', 'http://172.32.0.2'));
  assert.throws(() =>
    normalizeBase('http://example.com', 'http://example.com'),
  );
  assert.equal(
    normalizeBase('https://car.example.com/'),
    'https://car.example.com',
  );
  assert.equal(normalizeBase('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.throws(() => normalizeBase('https://user:secret@car.example.com'));
  assert.throws(() => normalizeBase('https://car.example.com/?key=secret'));
  assert.throws(() => normalizeBase('https://car.example.com/#key'));
});
