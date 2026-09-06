#!/usr/bin/env python3
"""Read new role/password from TMate .env; send SQL through stdin, never print it."""
import argparse
import os
import subprocess
import sys
from urllib.parse import urlparse, unquote
from deploy_common import read_env, identifier, secret

TABLES = ['cars', 'drives', 'positions', 'charging_processes', 'charges', 'states', 'addresses', 'geofences', 'updates']


def reader_sql(config, grant_updates=False):
    url = urlparse(config.get('DATABASE_URL', ''))
    if url.scheme not in ['postgres', 'postgresql'] or not url.hostname:
        raise ValueError('DATABASE_URL 格式无效')
    role = identifier(unquote(url.username or ''), '只读数据库用户名')
    database = identifier(unquote(url.path.lstrip('/')), '数据库名')
    if role in ['postgres', 'teslamate']:
        raise ValueError('只读账号必须使用新的专用角色，不能复用管理员')
    password = secret({'password': unquote(url.password or '')}, 'password', 16)
    if '\x00' in password or '\n' in password or '\r' in password:
        raise ValueError('数据库密码包含不支持的控制字符')
    literal = "'" + password.replace("'", "''") + "'"
    tables = ', '.join('public.' + table for table in TABLES)
    whitelist = ', '.join("'" + table + "'" for table in TABLES)
    if grant_updates:
        return role, database, f"""\set ON_ERROR_STOP on
BEGIN;
DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) THEN
    RAISE EXCEPTION 'Existing dedicated reader role required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege('{role}',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) THEN
    RAISE EXCEPTION 'Existing role has write access';
  END IF;
END $check$;
GRANT SELECT ON public.updates TO {role};
COMMIT;
"""
    # CREATE ROLE fails on an existing role; entire transaction then rolls back.
    sql = f"""\set ON_ERROR_STOP on
BEGIN;
SET LOCAL standard_conforming_strings = on;
CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD {literal};
GRANT CONNECT ON DATABASE {database} TO {role};
GRANT USAGE ON SCHEMA public TO {role};
GRANT SELECT ON {tables} TO {role};
ALTER ROLE {role} SET default_transaction_read_only = on;
DO $check$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND ((c.relname NOT IN ({whitelist}) AND has_table_privilege('{role}',c.oid,'SELECT'))
        OR has_table_privilege('{role}',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))) THEN
    RAISE EXCEPTION 'Unexpected inherited/PUBLIC privileges; refusing unsafe reader';
  END IF;
END $check$;
COMMIT;
"""
    return role, database, sql


def main():
    parser = argparse.ArgumentParser(description='创建只读角色；现有角色直接拒绝，不修改密码或车辆数据')
    parser.add_argument('--env', default='.env')
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--container', help='现有 PostgreSQL 容器名，使用容器内 psql')
    modes.add_argument('--admin-env', help='原生数据库管理员配置文件')
    parser.add_argument('--admin-user', default='teslamate', help='Docker 数据库管理员用户名')
    parser.add_argument('--check', action='store_true', help='只检查配置，不执行 SQL')
    parser.add_argument('--grant-updates', action='store_true', help='仅给现有专用只读角色增加 updates 表 SELECT；不创建角色、不改密码')
    args = parser.parse_args()
    role, database, sql = reader_sql(read_env(args.env), args.grant_updates)
    env = dict(os.environ)
    if args.container:
        if not __import__('re').fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', args.container):
            raise ValueError('数据库容器名无效')
        identifier(args.admin_user, '管理员用户名')
        command = ['docker', 'exec', '-i', args.container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', args.admin_user, '-d', database]
    else:
        admin = read_env(args.admin_env)
        if set(admin) - {'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT'}:
            raise ValueError('管理员配置包含未知字段')
        secret(admin, 'PGPASSWORD', 1)
        if admin.get('PGDATABASE') != database:
            raise ValueError('管理员配置的数据库名必须与 DATABASE_URL 相同')
        env.update(admin)
        command = ['psql', '-X', '-v', 'ON_ERROR_STOP=1']
    if args.check:
        print('只读角色配置检查通过；尚未连接数据库或执行 SQL。')
        return
    result = subprocess.run(command, input=sql, text=True, capture_output=True, env=env, timeout=30, check=False)
    if result.returncode:
        raise ValueError('创建未完成且事务已回滚。请检查管理员连接、TeslaMate 表是否已初始化、角色是否已存在或 PUBLIC 权限是否过宽。为避免泄露密码，不输出原始 SQL 错误。')
    print(f'已为只读角色 {role} 增加 updates 表 SELECT。没有修改密码或车辆数据。' if args.grant_updates else f'已创建只读角色 {role}：仅允许九张业务表 SELECT，默认只读事务。没有修改车辆数据。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(str(error) if isinstance(error, ValueError) else '配置或数据库命令不可用；请检查 Python / psql / Docker 和文件权限。', file=sys.stderr)
        sys.exit(1)
