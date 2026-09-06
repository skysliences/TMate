'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Battery,
  Home,
  RefreshCw,
  Route,
  Settings2,
  ShieldCheck,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { GlassNavigation } from './glass-navigation';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Overview, BatteryView, NoData } from './data-views';
import { ConnectionSettings } from './connection-settings';
import { RecordList } from './record-list';
import { RecordDetail, type Detail } from './record-detail';
import { api, type Connection } from '@/lib/api';
import { makeDemo, dateLabel, type Dashboard, type CarInfo } from '@/lib/data';
import { registerSummaryTool } from '@/lib/webmcp';
import { useDevicePreference } from '@/lib/preferences';
import { restoreDevice, deviceSession } from '@/lib/device-session';
import { tabDirection } from '@/lib/navigation-motion';
import { parseElectricityPrice } from '@/lib/electricity';
const nav = [
  { id: 'overview', label: '概览', icon: Home },
  { id: 'drives', label: '行程', icon: Route },
  { id: 'charges', label: '充电', icon: Zap },
  { id: 'battery', label: '电池', icon: Battery },
  { id: 'settings', label: '设置', icon: Settings2 },
];
const demoCars = [makeDemo(1).car, makeDemo(2).car];
export default function VoltLogApp() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            gcTime: 300000,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Application />
    </QueryClientProvider>
  );
}
function Application() {
  const client = useQueryClient();
  const [navigation, setNavigation] = useState({
    tab: 'overview',
    direction: 1,
  });
  const tab = navigation.tab;
  const setTab = useCallback((next: string) => {
    setNavigation((previous) =>
      previous.tab === next
        ? previous
        : {
            tab: next,
            direction: tabDirection(previous.tab, next),
          },
    );
  }, []);
  const [days, setDays] = useState('30');
  const [carId, setCarId] = useState(1);
  const [cars, setCars] = useState<CarInfo[]>([]);
  const [booting, setBooting] = useState(true);
  const [localService, setLocalService] = useState(false);
  const [pairingEnabled, setPairingEnabled] = useState(false);
  const [connectionNote, setConnectionNote] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [storedCurrency, setCurrency] = useDevicePreference(
    'voltlog-currency',
    '¥',
  );
  const currency = ['¥', '$', '€', '£'].includes(storedCurrency)
    ? storedCurrency
    : '¥';
  const [storedPrice, setPrice] = useDevicePreference('tmate-electricity-price', '');
  let electricityPrice: number | null = null;
  try { electricityPrice = parseElectricityPrice(storedPrice); } catch { /* Ignore malformed device preferences. */ }
  const [refreshNote, setRefreshNote] = useState('');
  const query = useQuery({
    queryKey: ['dashboard', connection?.session, carId, days],
    enabled: !booting && cars.length > 0 && (!localService || !!connection),
    queryFn: async ({ signal }) =>
      connection
        ? api<Dashboard>(
            connection,
            `/cars/${carId}/dashboard?days=${days}`,
            signal,
          )
        : makeDemo(carId),
    staleTime: 30000,
    refetchInterval: connection ? 60000 : false,
  });
  // NAS pages never show example vehicles while waiting for device authorization.
  const data =
    query.data ??
    (!booting && !connection && !localService ? makeDemo(carId) : null);
  const selected = cars.find((c) => c.id === carId);
  const snapshot = useRef({
    data,
    days: Number(days),
    demo: !connection,
    stale: query.isError,
  });
  useEffect(() => {
    snapshot.current = {
      data,
      days: Number(days),
      demo: !connection,
      stale: query.isError,
    };
  }, [data, days, connection, query.isError]);
  useEffect(() => registerSummaryTool(() => snapshot.current), []);
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timer = setTimeout(() => controller.abort(), 20000);
    void restoreDevice(controller.signal)
      .then((result) => {
        if (!mounted) return;
        client.clear();
        setLocalService(result.local);
        setPairingEnabled(result.pairingEnabled === true);
        setConnectionNote(result.error || '');
        if (result.connection) {
          setConnection(result.connection);
          setCars(result.cars || []);
          setCarId(result.cars?.[0]?.id ?? 1);
        } else {
          setCars(result.local ? [] : demoCars);
          if (result.local) setTab('settings');
        }
      })
      .catch(() => {
        if (!mounted) return;
        setLocalService(true);
        setCars([]);
        setTab('settings');
        setConnectionNote('连接超时，请刷新网页重试');
      })
      .finally(() => {
        clearTimeout(timer);
        if (mounted) setBooting(false);
      });
    return () => {
      mounted = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, setTab]);
  function connect(c: Connection, list: CarInfo[]) {
    client.clear();
    setDetail(null);
    setConnection(c);
    setCars(list);
    setCarId(list[0]?.id ?? 1);
    setTab('overview');
    setRefreshNote('');
    setConnectionNote('');
  }
  async function disconnect() {
    if (connection?.auth === 'cookie') {
      try {
        await deviceSession('DELETE');
      } catch {
        setConnectionNote('退出失败，请检查网络后重试');
        return;
      }
    }
    client.clear();
    setDetail(null);
    setConnection(null);
    setCars(localService ? [] : demoCars);
    if (localService) setTab('settings');
    setCarId(1);
    setRefreshNote('');
  }
  function chooseCar(id: number) {
    setDetail(null);
    setCarId(id);
    setRefreshNote('');
  }
  async function refresh() {
    setRefreshNote('');
    const result = await query.refetch();
    if (!result.isError)
      setRefreshNote(connection ? '数据已刷新' : '演示数据已刷新');
    await client.invalidateQueries({ queryKey: ['records'] });
  }
  return (
    <div className="app-shell">
      <Tabs
        value={tab}
        onValueChange={(v) =>
          setTab(localService && !connection ? 'settings' : String(v))
        }
        className="app-tabs"
      >
        <header className="app-header">
          <button
            type="button"
            onClick={() =>
              setTab(localService && !connection ? 'settings' : 'overview')
            }
            className="brand"
            aria-label="TMate 首页"
          >
            <span className="brand-mark" aria-hidden="true" />
            TMate
          </button>
          <GlassNavigation
            value={tab}
            onNavigate={setTab}
            disabled={booting || (localService && !connection)}
          />
          <div className="header-right">
            <button
              className={connection ? 'connected-pill' : 'demo-pill'}
              onClick={() => setTab('settings')}
            >
              <ShieldCheck size={14} />
              {booting
                ? '正在连接'
                : connection
                  ? '已连接'
                  : localService
                    ? '待配对'
                    : '演示数据'}
            </button>
          </div>
        </header>
        <main className="workspace">
          {booting ? (
            <div className="connection-intro panel" aria-live="polite">
              <RefreshCw className="refresh-spin" size={24} />
              <h2>正在连接数据服务</h2>
              <p className="subtle">检查此设备的连接状态…</p>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    {tab === 'overview'
                      ? '我的特斯拉'
                      : nav.find((n) => n.id === tab)?.label}
                  </h1>
                  <div className="car-picker">
                    {cars.length > 0 && (
                      <Select
                        value={String(carId)}
                        onValueChange={(v) => v && chooseCar(Number(v))}
                      >
                        <SelectTrigger aria-label="切换车辆">
                          <SelectValue>
                            {selected?.name} · Model {selected?.model}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {cars.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name} · Model {c.model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <span className="car-trim">{selected?.trim}</span>
                  </div>
                </div>
                {tab !== 'settings' && (
                  <div className="heading-actions">
                    <Select value={days} onValueChange={(v) => v && setDays(v)}>
                      <SelectTrigger aria-label="统计时间范围">
                        <SelectValue>最近 {days} 天</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {['7', '30', '90'].map((d) => (
                          <SelectItem key={d} value={d}>
                            最近 {d} 天
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={refresh}
                      disabled={query.isFetching || !cars.length}
                      aria-label="刷新数据"
                    >
                      <RefreshCw
                        size={17}
                        className={query.isFetching ? 'refresh-spin' : ''}
                      />
                    </Button>
                  </div>
                )}
              </div>
              <output className="refresh-status">{refreshNote}</output>
              {connectionNote && (
                <p className="error-message" role="alert">
                  {connectionNote}
                </p>
              )}
              {query.isError && tab !== 'settings' && (
                <div className="error-banner" role="alert">
                  <AlertCircle size={18} />
                  <div>
                    {query.error.message}
                    {data && <p>当前展示上次成功读取的数据，请稍后刷新。</p>}
                  </div>
                  <Button variant="outline" onClick={() => setTab('settings')}>
                    检查连接
                  </Button>
                </div>
              )}
              {!data &&
                cars.length > 0 &&
                tab !== 'settings' &&
                query.isPending && (
                  <div className="loading-grid" aria-label="正在读取车辆数据">
                    <Skeleton className="h-80" />
                    <Skeleton className="h-80" />
                  </div>
                )}
              {!cars.length && tab !== 'settings' && (
                <NoData
                  title="还没有车辆"
                  note="数据服务已连接，TeslaMate 数据库尚未记录车辆。完成车辆配置后，请在设置重新连接。"
                />
              )}
              <div
                className="tab-stage"
                style={
                  { '--page-direction': navigation.direction } as CSSProperties
                }
              >
                {data && cars.length > 0 && (
                  <>
                    <TabsContent value="overview">
                      <Overview
                        electricityPrice={electricityPrice}
                        data={data}
                        days={Number(days)}
                        currency={currency}
                        onNavigate={setTab}
                        onDrive={(record) =>
                          setDetail({ type: 'drive', record })
                        }
                        onCharge={(record) =>
                          setDetail({ type: 'charge', record })
                        }
                      />
                    </TabsContent>
                    <TabsContent value="drives">
                      <RecordList
                        electricityPrice={electricityPrice}
                        kind="drives"
                        data={data}
                        days={Number(days)}
                        connection={connection}
                        currency={currency}
                        onDetail={setDetail}
                      />
                    </TabsContent>
                    <TabsContent value="charges">
                      <RecordList
                        electricityPrice={electricityPrice}
                        kind="charges"
                        data={data}
                        days={Number(days)}
                        connection={connection}
                        currency={currency}
                        onDetail={setDetail}
                      />
                    </TabsContent>
                    <TabsContent value="battery">
                      <BatteryView data={data} days={Number(days)} />
                    </TabsContent>
                  </>
                )}
                <TabsContent value="settings">
                  <ConnectionSettings
                    electricityPrice={storedPrice}
                    onElectricityPrice={setPrice}
                    pairingEnabled={pairingEnabled}
                    localService={localService}
                    connection={connection}
                    onConnect={connect}
                    onDisconnect={disconnect}
                    currency={currency}
                    onCurrency={setCurrency}
                  />
                </TabsContent>
              </div>
              <footer className="page-footer">
                <span>
                  <span
                    className={`connection-dot ${connection ? 'is-connected' : ''}`}
                  />
                  {!connection
                    ? localService
                      ? 'TMate 服务 · 等待设备授权'
                      : '演示模式 · 未连接车辆'
                    : data?.status.live
                      ? 'MQTT 已连接 · 每 60 秒刷新'
                      : '历史记录 · 每 60 秒刷新'}
                  {connection &&
                    data?.asOf &&
                    ` · 读取于 ${dateLabel(data.asOf, true)}`}
                </span>
                <span>
                  TMate <span className="footer-divider">/</span> Powered by
                  TeslaMate
                </span>
              </footer>
              {connection && data && tab === 'overview' && (
                <p className="freshness-note">
                  {data.status.live
                    ? 'MQTT 可能包含保留消息；车辆休眠时数据不会持续更新。'
                    : `电量记录时间：${data.status.updatedAt ? dateLabel(data.status.updatedAt, true) : '未提供'}。连接 MQTT 可补充锁车、胎压与实时状态。`}
                </p>
              )}
            </>
          )}
        </main>
      </Tabs>
      <RecordDetail
        electricityPrice={electricityPrice}
        detail={detail}
        onClose={() => setDetail(null)}
        connection={connection}
        carId={carId}
        currency={currency}
      />
    </div>
  );
}
