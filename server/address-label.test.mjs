import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressLabel } from './address-label.mjs';
import { normalizeRecord } from './domain.mjs';

void test('Chinese names beat English geocoder display names, with simplified Chinese preferred', () => {
  const place = {
    address: {
      name: 'Century Avenue',
      raw: {
        name: 'Century Avenue',
        namedetails: {
          'name:en': 'Century Avenue',
          'name:zh': '世紀大道',
          'name:zh-Hans': '世纪大道',
        },
      },
    },
  };
  assert.equal(addressLabel(place), '世纪大道');
  assert.equal(
    addressLabel({
      address: { name: 'English', raw: { namedetails: { name: '世纪大道' } } },
    }),
    '世纪大道',
  );
  assert.equal(addressLabel({ address: { name: '世纪大道' } }), '世纪大道');
});

void test('custom geofences are preserved and whitespace-only names fall through', () => {
  const place = { geofence: ' Home ', address: { name: '世纪大道' } };
  assert.equal(addressLabel(place), 'Home');
  assert.equal(addressLabel({ ...place, geofence: ' ' }), '世纪大道');
  assert.equal(addressLabel({ ...place, geofence: '家' }), '家');
});

void test('Chinese road components form a readable label without duplicating the locality', () => {
  assert.equal(
    addressLabel({
      address: { city: '上海市', road: '世纪大道', house_number: '100' },
    }),
    '上海市世纪大道100号',
  );
  assert.equal(
    addressLabel({
      address: {
        raw: {
          address: {
            village: '示例村',
            road: '示例村北路',
            house_number: '12',
          },
        },
      },
    }),
    '示例村北路12号',
  );
  assert.equal(
    addressLabel({
      address: {
        raw: { address: { hamlet: '示例村', pedestrian: '中心步行街' } },
      },
    }),
    '示例村中心步行街',
  );
});

void test('locality-only Chinese records are clearly marked as nearby, never mistranslated', () => {
  assert.equal(
    addressLabel({
      address: {
        name: 'Example Highway',
        city: 'Example City',
        road: 'Example Highway',
        raw: { address: { hamlet: '示例村', city: 'Example City' } },
      },
    }),
    '示例村附近',
  );
  assert.equal(
    addressLabel({ address: { city: '示例市', road: 'Example Road' } }),
    '示例市附近',
  );
});

void test('missing or malformed localized metadata falls back honestly without data loss', () => {
  for (const value of [null, undefined, {}, [], { address: { raw: null } }])
    assert.equal(addressLabel(value), '未知地点');
  assert.equal(
    addressLabel({
      address: {
        name: 'Broadway',
        raw: { namedetails: { 'name:zh': ' ', name: {} } },
      },
    }),
    'Broadway',
  );
  assert.equal(
    addressLabel({ address: { city: 'London', road: 'Baker Street' } }),
    'London Baker Street',
  );
  assert.equal(
    addressLabel({ address: { display_name: 'Recorded original address' } }),
    'Recorded original address',
  );
  assert.equal(addressLabel('家'), '家');
});

void test('API normalization emits only labels, never nested raw geocoder metadata', () => {
  const place = {
    address: {
      name: 'English',
      latitude: 1,
      longitude: 2,
      raw: { namedetails: { 'name:zh': '示例路' }, osm_id: 123 },
    },
  };
  const original = JSON.stringify(place);
  assert.deepEqual(
    normalizeRecord({
      start: place,
      end: place,
      location: place,
      distance: '12.5',
    }),
    { start: '示例路', end: '示例路', location: '示例路', distance: 12.5 },
  );
  assert.equal(JSON.stringify(place), original);
});
