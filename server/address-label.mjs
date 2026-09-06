// Read Chinese names already stored by TeslaMate's geocoder. No network calls,
// machine translation, or changes to the source address records.
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const chinese = (value) =>
  /\p{Script=Han}/u.test(text(value)) ? text(value) : '';
const firstChinese = (values) => values.map(chinese).find(Boolean) || '';
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function addressLabel(value) {
  if (typeof value === 'string') return text(value) || '未知地点';
  const place = object(value);
  // A user's own geofence name always wins, even when it is in another language.
  if (text(place.geofence)) return text(place.geofence);
  const address = object(place.address);
  const raw = object(address.raw);
  const names = object(raw.namedetails);
  const parts = object(raw.address);
  const name = firstChinese([
    names['name:zh-Hans'],
    names['name:zh-CN'],
    names['name:zh'],
    names['name:zh-Hant'],
    names['name:zh-TW'],
    names['name:zh-HK'],
    address.name,
    raw.name,
    names.name,
    names.official_name,
  ]);
  if (name) return name;

  const road = firstChinese([
    address.road,
    ...[
      'road',
      'footway',
      'street',
      'street_name',
      'residential',
      'path',
      'pedestrian',
      'square',
    ].map((key) => parts[key]),
  ]);
  const locality = firstChinese([
    ...[
      'hamlet',
      'village',
      'neighbourhood',
      'suburb',
      'quarter',
      'subdistrict',
      'township',
      'town',
      'city_district',
      'district',
    ].map((key) => parts[key]),
    address.neighbourhood,
    address.city,
    parts.city,
    parts.municipality,
    address.county,
    parts.county,
  ]);
  if (road) {
    const prefix = locality && !road.includes(locality) ? locality : '';
    const houseNumber = text(address.house_number) || text(parts.house_number);
    // Only a plain numeric house number can safely acquire the Chinese suffix.
    const number = /^\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?$/.test(houseNumber)
      ? `${houseNumber}号`
      : chinese(houseNumber);
    return `${prefix}${road}${number}`;
  }
  // Locality-only names must not masquerade as a translated street address.
  if (locality) return `${locality}附近`;
  // No trustworthy Chinese data: keep the original, never invent a place name.
  return (
    text(address.name) ||
    [text(address.city), text(address.road)].filter(Boolean).join(' ') ||
    text(address.display_name) ||
    '未知地点'
  );
}
