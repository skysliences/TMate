// Run inside the NAS container. Output is a one-use link, never the service key.
const port = Number(process.env.PORT || 8787);
const host = ['0.0.0.0', '::', '', undefined].includes(process.env.HOST)
  ? '127.0.0.1' : process.env.HOST;
const response = await fetch(`http://${host}:${port}/api/pairings`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
});
if (!response.ok) throw new Error(`Pairing unavailable (${response.status})`);
console.log(JSON.stringify(await response.json()));
