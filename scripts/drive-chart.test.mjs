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
let YAxis;
let Line;
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
  ({ XAxis, YAxis, Line } = await import('recharts'));
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
    assert.equal(axis.props.tickFormatter(time), '20:34:00');
    assert.equal(axis.props.tickFormatter(NaN), '—');
  });
}

void test('dense and sparse curves span the trip and do not cover each other with white dots', async () => {
  const makeSamples = (count) =>
    Array.from({ length: count }, (_, i) => ({
      date: new Date(time + (i / (count - 1)) * 240000).toISOString(),
      value: i < count / 2 ? 97 : 96,
    }));
  const series = { battery: makeSamples(801), usableBattery: makeSamples(17) };
  const chart = BatteryChart({
    title: '电量变化',
    fields: Object.keys(series),
    data: { series },
    unit: '%',
  });
  const container = findElement(chart, ChartContainer);
  const lines = container.props.children.props.children
    .flat()
    .filter((item) => item?.type === Line);
  const xAxis = findElement(chart, XAxis).props;
  const yAxis = findElement(chart, YAxis).props;
  assert.deepEqual(xAxis.domain, [time, time + 240000]);
  assert.deepEqual(yAxis.domain, [94, 99]);
  assert.equal(
    new Set(xAxis.ticks.map(xAxis.tickFormatter)).size,
    xAxis.ticks.length,
  );
  assert.equal(lines.length, 2);
  assert.ok(lines[0].props.strokeWidth > lines[1].props.strokeWidth);
  const { computeLinePoints } = await import('recharts/lib/cartesian/Line.js');
  for (const line of lines) {
    const { data, dataKey, dot, fill } = line.props;
    assert.equal(data.length, series[dataKey].length);
    const dots = data
      .map((_, index) => dot({ cx: index, cy: 10, index }))
      .filter(Boolean);
    assert.equal(dots.length, 2);
    for (const marker of dots) {
      assert.equal(marker.props.fill, fill);
      assert.notEqual(marker.props.fill, '#fff');
    }
    const geometry = computeLinePoints({
      layout: 'horizontal',
      dataKey,
      displayedData: data,
      xAxis: {
        type: 'number',
        dataKey: 'time',
        scale: { map: (v) => ((v - time) / 240000) * 280 },
      },
      yAxis: { scale: { map: (v) => 160 - ((v - 94) / 5) * 160 } },
      xAxisTicks: [],
      yAxisTicks: [],
      bandSize: 0,
    });
    assert.equal(geometry[0].x, 0);
    assert.equal(geometry.at(-1).x, 280);
    assert.ok(
      geometry.every(
        (point) => Number.isFinite(point.x) && point.y > 0 && point.y < 160,
      ),
    );
  }
});

void test('isolated samples and real missing intervals keep visible colored endpoints', () => {
  const series = {
    battery: [
      { date: new Date(time).toISOString(), value: 97 },
      { date: new Date(time + 240000).toISOString(), value: 96 },
    ],
  };
  const chart = BatteryChart({
    title: '电量变化',
    fields: ['battery'],
    data: { series },
    unit: '%',
  });
  const line = findElement(chart, Line);
  assert.equal(line.props.connectNulls, false);
  assert.equal(line.props.data.length, 3);
  assert.ok(line.props.dot({ cx: 0, cy: 10, index: 0 }));
  assert.equal(line.props.dot({ cx: 1, cy: 10, index: 1 }), null);
  assert.ok(line.props.dot({ cx: 2, cy: 10, index: 2 }));
});

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
