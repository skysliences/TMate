#!/usr/bin/env python3
"""Install only the official TeslaMate stack, never overwrite an existing one."""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from deploy_common import read_env, secret, identifier

ROOT = Path(__file__).resolve().parent.parent
KEYS = set(read_env(ROOT / 'deploy/teslamate/.env.example'))


def validate(config):
    if set(config) - KEYS:
        raise ValueError('配置包含未知字段；请从 deploy/teslamate/.env.example 复制')
    for key in ['ENCRYPTION_KEY', 'DATABASE_PASS', 'GRAFANA_ADMIN_PASSWORD']:
        secret(config, key)
    if len({config[key] for key in ['ENCRYPTION_KEY', 'DATABASE_PASS', 'GRAFANA_ADMIN_PASSWORD']}) != 3:
        raise ValueError('加密密钥、数据库密码和 Grafana 密码必须互不相同')
    identifier(config.get('DATABASE_USER', ''), 'DATABASE_USER')
    identifier(config.get('DATABASE_NAME', ''), 'DATABASE_NAME')
    for key in ['TESLAMATE_PROJECT_NAME', 'TESLAMATE_NETWORK']:
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', config.get(key, '')):
            raise ValueError(f'{key} 格式无效')
    for key in ['TESLAMATE_VERSION', 'GRAFANA_VERSION', 'MOSQUITTO_VERSION']:
        if not re.fullmatch(r'\d+(?:\.\d+){0,2}(?:-[a-z0-9.-]+)?', config.get(key, '')):
            raise ValueError(f'{key} 必须指定版本，不能使用 latest')
    if not re.fullmatch(r'18(?:\.\d+)?-trixie', config.get('POSTGRES_VERSION', '')):
        raise ValueError('此全新安装模板仅使用 PostgreSQL 18；禁止直接接入旧主版本卷')
    bind = config.get('TM_BIND_ADDRESS', '')
    try:
        address = ipaddress.IPv4Address(bind)
    except ValueError:
        raise ValueError('TM_BIND_ADDRESS 必须填写本机回环或家庭局域网 IPv4') from None
    private = any(address in ipaddress.ip_network(network) for network in ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'])
    if not private:
        raise ValueError('安装器不允许绑定公网或所有网卡，请使用回环/家庭 LAN 地址')
    for key in ['TESLAMATE_PORT', 'GRAFANA_PORT']:
        if not config.get(key, '').isdigit() or not 1024 <= int(config[key]) <= 65535:
            raise ValueError(f'{key} 端口必须位于 1024–65535')
    if config['TESLAMATE_PORT'] == config['GRAFANA_PORT']:
        raise ValueError('TeslaMate 与 Grafana 不能使用相同端口')
    for key in ['TESLAMATE_HOSTNAME', 'TESLA_API_HOST', 'TESLA_WSS_HOST']:
        if not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?', config.get(key, '')):
            raise ValueError(f'{key} 只填写主机名或 IP，不包含协议和端口')
    return config


def main():
    parser = argparse.ArgumentParser(description='TMate 前置 TeslaMate 安装器：只用官方镜像，拒绝覆盖，绝不删除卷')
    parser.add_argument('--env', default=str(ROOT / 'deploy/teslamate/.env'))
    parser.add_argument('--check', action='store_true', help='只校验配置，不连接 Docker')
    parser.add_argument('--dry-run', action='store_true', help='仅显示操作范围，不连接 Docker')
    args = parser.parse_args()
    config = validate(read_env(args.env))
    if args.check or args.dry_run:
        print('配置检查通过。将创建独立 TeslaMate/PostgreSQL/Grafana/MQTT 栈；不会修改已有部署、安装 Docker 或删除卷。')
        return
    if not shutil.which('docker'):
        raise ValueError('未找到 Docker；请先按官方教程安装 Docker Engine/Desktop 与 Compose v2 插件')
    if os.name == 'posix' and Path(args.env).stat().st_mode & 0o077:
        raise ValueError('配置权限过宽，请先 chmod 600 你的配置文件')
    env = dict(os.environ)
    # Configuration file is authoritative, even when the invoking shell has old values.
    for key in KEYS:
        env.pop(key, None)
    env.update(config)
    env['COMPOSE_ANSI'] = 'never'

    def run(command):
        result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=600, check=False)
        if result.returncode:
            raise ValueError('Docker 操作未完成。现有数据未删除；请检查 Docker 权限、端口及官方镜像仓库连接，再按部署教程处理。')
        return result.stdout.strip()

    run(['docker', 'info', '--format', '{{.ServerVersion}}'])
    run(['docker', 'compose', 'version'])
    images = run(['docker', 'ps', '-a', '--format', '{{.Image}}'])
    project = config['TESLAMATE_PROJECT_NAME']
    existing = run(['docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={project}'])
    volumes = run(['docker', 'volume', 'ls', '-q', '--filter', f'label=com.docker.compose.project={project}'])
    networks = run(['docker', 'network', 'ls', '--format', '{{.Name}}']).splitlines()
    if existing or volumes or config['TESLAMATE_NETWORK'] in networks or re.search(r'(?:^|/)teslamate/teslamate[:@]', images, re.M):
        raise ValueError('检测到已有 TeslaMate 容器、项目卷或同名网络，拒绝覆盖。请直接接入已有 TeslaMate；更新和失败重试见部署教程。')
    command = ['docker', 'compose', '--project-name', project, '--env-file', str(Path(args.env).resolve()), '-f', str(ROOT / 'deploy/teslamate/compose.yaml')]
    run(command + ['config', '--quiet'])
    print('正在下载官方固定版本镜像（首次可能需要几分钟）…', flush=True)
    run(command + ['pull'])
    print('正在启动独立采集栈，保留所有持久卷…', flush=True)
    run(command + ['up', '-d', '--wait', '--wait-timeout', '180'])
    print(f"容器已启动。TeslaMate: http://{config['TM_BIND_ADDRESS']}:{config['TESLAMATE_PORT']}，Grafana: http://{config['TM_BIND_ADDRESS']}:{config['GRAFANA_PORT']}")
    print('下一步：按官方指南获取 Tesla Token，在 TeslaMate 页面完成授权；此脚本不会获取你的 Tesla 登录信息。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(str(error) if isinstance(error, ValueError) else '配置文件或 Docker 操作失败，请检查部署教程；不输出凭据。', file=sys.stderr)
        sys.exit(1)
