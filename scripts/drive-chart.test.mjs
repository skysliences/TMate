import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

let server;
let BatteryChart;
let ChartContainer;
let ChartTooltip;
let XAxis;
let ChartErrorBoundary;

before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  server = await createServer({
    root,
    configFile: false,
    plugins: [react()],
    resolve: { alias: { '@': root } },
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  });
  ({ BatteryChart } = await server.ssrLoadModule(
    '/components/drive-telemetry.tsx',
  ));
  ({ ChartContainer, ChartTooltip } = await server.ssrLoadModule(
    '/components/ui/chart.tsx',
  ));
  ({ ChartErrorBoundary } = await server.ssrLoadModule(
    '/components/chart-error-boundary.tsx',
  ));
  ({ XAxis } = await import('recharts'));
});

after(async () => {
  await server?.close();
});

function findElement(tree, type) {
  if (Array.isArray(tree))
    return tree.map((child) => findElement(child, type)).find(Boolean);
  if (!isValidElement(tree)) return undefined;
  return tree.type === type ? tree : findElement(tree.props.children, type);
}

const time = Date.parse('2026-09-06T12:34:00Z');
const labels = {
  battery: '电量 SOC',
  usableBattery: '可用电量',
  ratedRange: '额定续航',
  estimatedRange: '预估续航',
  heater: '电池加热',
};

for (const [key, label] of Object.entries(labels)) {
  void test(`actual battery tooltip renders numeric X-axis time for ${label}`, () => {
    const series = Object.fromEntries(
      Object.keys(labels).map((field) => [
        field,
        [{ date: new Date(time).toISOString(), value: 0 }],
      ]),
    );
    const chart = BatteryChart({
      title: label,
      fields: [key],
      data: { series },
      unit: key === 'heater' ? 'state' : key.endsWith('Range') ? 'km' : '%',
    });
    const container = findElement(chart, ChartContainer);
    const content = findElement(chart, ChartTooltip).props.content;
    // Use the real chart wrapper AND the callback wired by BatteryChart. A helper
    // test alone missed the wrapper replacing numeric labels with series names.
    const render = (active, payload) =>
      renderToStaticMarkup(
        createElement(
          ChartContainer,
          { config: container.props.config },
          createElement(content.type, {
            ...content.props,
            active,
            label: time,
            payload,
          }),
        ),
      );
    const payload = [
      { dataKey: key, name: key, value: 0, payload: { time, [key]: 0 } },
    ];
    assert.doesNotThrow(() => render(false, []));
    const activeHtml = render(true, payload);
    assert.match(activeHtml, /09\/06 20:34/);
    assert.ok(activeHtml.includes(label));
    assert.match(activeHtml, key === 'heater' ? /关闭/ : /0\.0/);
    assert.doesNotThrow(() => render(false, payload));
    assert.match(
      render(true, [{ ...payload[0], payload: { time: 'invalid' } }]),
      /时间未记录/,
    );
    const axis = findElement(chart, XAxis);
    assert.equal(axis.props.tickFormatter(time), '20:34');
    assert.equal(axis.props.tickFormatter(NaN), '—');
  });
}

void test('chart error fallback is local, readable and offers a reset', () => {
  const child = createElement('p', null, '正常图表');
  const boundary = new ChartErrorBoundary({
    title: '电量变化',
    children: child,
  });
  assert.equal(boundary.render(), child);
  boundary.state = ChartErrorBoundary.getDerivedStateFromError(
    new Error('test'),
  );
  const fallback = boundary.render();
  const html = renderToStaticMarkup(fallback);
  assert.match(html, /role="alert"/);
  assert.match(html, /电量变化暂时无法显示/);
  assert.match(html, /其他行程数据不受影响/);
  assert.match(html, /重新加载图表/);
  boundary.setState = (next) => {
    boundary.state = { ...boundary.state, ...next };
  };
  fallback.props.children[1].props.onClick();
  assert.equal(boundary.render(), child);
});
