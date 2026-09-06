'use client';
import { useState, type SubmitEvent } from 'react';
import { Cable, Link, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SectionTitle } from './data-views';
import { api, normalizeBase, type Connection } from '@/lib/api';
import type { CarInfo } from '@/lib/data';
import { useDevicePreference } from '@/lib/preferences';
import { cookieConnection, deviceSession } from '@/lib/device-session';
import { DEFAULT_SERVER_URL, isAndroidApp } from '@/lib/native-transport';
import { parseElectricityPrice } from '@/lib/electricity';
export function ConnectionSettings({
  connection,
  onConnect,
  onDisconnect,
  currency,
  onCurrency,
  electricityPrice,
  onElectricityPrice,
  localService = false,
  pairingEnabled = false,
}: {
  connection: Connection | null;
  onConnect: (c: Connection, cars: CarInfo[]) => void;
  onDisconnect: () => void | Promise<void>;
  currency: string;
  onCurrency: (v: string) => void;
  electricityPrice: string;
  onElectricityPrice: (v: string) => boolean;
  localService?: boolean;
  pairingEnabled?: boolean;
}) {
  const androidApp = isAndroidApp();
  const [savedBase, saveBase] = useDevicePreference('voltlog-service', '');
  const [baseDraft, setBase] = useState<string | null>(null);
  const base =
    baseDraft ??
    connection?.base ??
    (androidApp
      ? savedBase || DEFAULT_SERVER_URL
      : localService && typeof window !== 'undefined'
        ? window.location.origin
        : savedBase || DEFAULT_SERVER_URL);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [priceNote, setPriceNote] = useState('');
  const [priceError, setPriceError] = useState('');
  function savePrice(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPriceNote('');
    setPriceError('');
    try {
      const value = parseElectricityPrice(priceDraft ?? electricityPrice);
      if (!onElectricityPrice(value == null ? '' : String(value))) throw new Error('当前设备禁止保存本地设置，请允许站点存储后重试');
      setPriceDraft(null);
      setPriceNote(value == null ? '已关闭费用估算' : `已保存：${currency} ${value} / kWh`);
    } catch (error) {
      setPriceError(error instanceof Error ? error.message : '单价格式无效');
    }
  }
  async function connect(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      let c: Connection = {
        base: normalizeBase(base),
        key: key.trim(),
        session: Date.now(),
      };
      if (c.key.length < 32)
        throw new Error('请输入至少 32 位的数据服务访问密钥');
      if (pairingEnabled && c.base === window.location.origin) {
        await deviceSession('POST', c.key);
        c = cookieConnection();
      }
      const result = await api<{ cars: CarInfo[] }>(c, '/cars');
      if (
        !Array.isArray(result.cars) ||
        result.cars.some(
          (car) => typeof car.id !== 'number' || typeof car.name !== 'string',
        )
      )
        throw new Error('该地址没有返回有效的 TMate 车辆数据');
      saveBase(c.base);
      setKey('');
      onConnect(c, result.cars);
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      <section className="panel settings-panel">
        <SectionTitle
          title="连接 TMate 数据服务"
        />
        <div className="connection-heading">
          <span className="record-icon">
            <Cable size={20} />
          </span>
          <div>
            <strong>
              {connection
                ? '数据服务已连接'
                : localService
                  ? '授权这台设备'
                  : '当前为演示模式'}
            </strong>
            <p className="subtle">
              {connection
                ? connection.base
                : localService
                  ? pairingEnabled
                    ? '打开一次性配对链接，或输入访问密钥，即可查看你的真实车辆数据。'
                    : '输入访问密钥，即可查看你的真实车辆数据。'
                  : '连接后，即可查看你的真实车辆数据。'}
            </p>
          </div>
        </div>
        {connection?.auth === 'cookie' ? (
          <div className="device-connected">
            <p className="field-help">
              这台设备已配对。30 天内再次打开网页将自动连接，无需重复输入密钥。
            </p>
            <Button type="button" variant="outline" onClick={onDisconnect}>
              退出此设备
            </Button>
          </div>
        ) : (
          <form className="connect-form" onSubmit={connect}>
            <label htmlFor="service-url">数据服务地址</label>
            <Input
              id="service-url"
              type="url"
              required
              placeholder="https://car.example.com"
              value={base}
              readOnly={localService && !androidApp}
              onChange={(e) => setBase(e.target.value)}
              autoComplete="url"
            />
            <p className="field-help">
              填写 TMate 的地址，而不是 TeslaMate 的 4000 或 Grafana 的 3000 端口。
            </p>
            {(!androidApp || DEFAULT_SERVER_URL) && <Button
              type="button"
              variant="outline"
              onClick={() =>
                setBase(
                  androidApp ? DEFAULT_SERVER_URL : window.location.origin,
                )
              }
            >
              {androidApp ? '使用配置中的地址' : '使用当前网页地址'}
            </Button>}
            {base.startsWith('http://') && (
              <p className="field-help">
                当前连接未加密，仅在可信家庭局域网使用。安卓需要在打包配置中明确允许此地址；外网请使用 HTTPS。
              </p>
            )}
            <label htmlFor="service-key">访问密钥</label>
            <Input
              id="service-key"
              type="password"
              required
              minLength={32}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="数据服务中设置的 API_KEY"
              autoComplete="off"
            />
            <p className="field-help">
              {pairingEnabled
                ? '填写服务器 .env 中的 API_KEY，或向管理员获取配对链接。连接后记住此设备 30 天。'
                : androidApp
                  ? '填写服务器 .env 中的 API_KEY，不是 Tesla 密码或高德 Key。App 完全退出后需重新填写。'
                  : '填写服务器 .env 中的 API_KEY，密钥仅保留在本次页面会话中。'}
            </p>
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <div className="form-actions">
              <Button type="submit" disabled={busy}>
                <Link size={16} />
                {busy
                  ? '正在验证连接…'
                  : connection
                    ? '更新连接'
                    : '连接数据服务'}
              </Button>
              {connection && (
                <Button type="button" variant="outline" onClick={onDisconnect}>
                  {localService ? '断开连接' : '断开并返回演示'}
                </Button>
              )}
            </div>
          </form>
        )}
        <p className="note">
          <ShieldCheck size={16} />
          这里只读取车辆数据，不需要你的 Tesla
          账号密码。数据库连接信息只保存在你自己的服务器。
        </p>
      </section>
      <div>
        <section className="panel">
          <SectionTitle title="显示偏好" />
          <div className="settings-label">
            费用货币
            <Select value={currency} onValueChange={(v) => v && onCurrency(v)}>
              <SelectTrigger aria-label="费用货币">
                <SelectValue>{currency}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {['¥', '$', '€', '£'].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="field-help">
            仅更换符号，不进行汇率换算。请与 TeslaMate 费用记录一致。
          </p>
          <p className="note settings-note">
            距离 km · 电量 kWh · 温度 °C
            <br />
            日期按中国标准时间显示
          </p>
          <form className="connect-form" onSubmit={savePrice}>
            <label htmlFor="electricity-price">电费单价（{currency} / kWh）</label>
            <Input id="electricity-price" inputMode="decimal" type="text"
              placeholder="例如 0.56，留空关闭估算"
              value={priceDraft ?? electricityPrice}
              onChange={event => { setPriceDraft(event.target.value); setPriceNote(''); setPriceError(''); }} />
            <p className="field-help">只补算费用未记录的充电，优先按电网用电量计算，缺失时按充入电量估算。不覆盖已有费用，不修改 TeslaMate。单价仅保存在当前设备，修改后会重新估算历史记录。</p>
            <Button type="submit">保存电费单价</Button>
            {priceError && <p role="alert" className="error-message">{priceError}</p>}
            {priceNote && <output className="field-help">{priceNote}</output>}
          </form>
        </section>
        <section className="panel app-info">
          <Smartphone size={23} />
          <h2>同一份数据，随身查看</h2>
          <p>
            网页支持手机和平板。工程附带 iOS 与 Android 项目，可使用 Xcode 或
            Android Studio 打包安装。
          </p>
          <a
            href="https://github.com/teslamate-org/teslamate"
            target="_blank"
            rel="noreferrer"
          >
            查看 TeslaMate 项目 ↗
          </a>
        </section>
      </div>
    </div>
  );
}
