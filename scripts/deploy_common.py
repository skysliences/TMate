"""Small strict dotenv reader: data only, never source/eval/expand the file."""
import re
from pathlib import Path


def read_env(path):
    result = {}
    for number, raw in enumerate(Path(path).read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
        if not match:
            raise ValueError(f'配置第 {number} 行格式无效；只支持 KEY=value')
        key, value = match.groups()
        if key in result:
            raise ValueError(f'重复的配置字段：{key}')
        value = value.strip()
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f'{key} 引号未配对')
            value = value[1:-1]
        if any(c in value for c in ['\x00', '\r', '\n']):
            raise ValueError(f'{key} 包含不支持的字符')
        result[key] = value
    return result


def secret(config, key, minimum=32):
    value = config.get(key, '')
    if len(value) < minimum or re.search(r'CHANGE_ME|REPLACE_WITH|YOUR_|填写|替换', value, re.I):
        raise ValueError(f'{key} 请填写自己的随机值（至少 {minimum} 位）')
    return value


def identifier(value, name):
    if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}', value):
        raise ValueError(f'{name} 仅支持小写字母、数字和下划线，不能以数字开头')
    return value
