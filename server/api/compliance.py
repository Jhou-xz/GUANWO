import re

REPLACEMENTS = [
    (re.compile(r'改运|转运|交运转好|时来运转'), ''),
    (re.compile(r'消灾(?:解难|化解)?|消灾解厄|破解灾[厄祸]|化解灾[厄祸劫]'), ''),
    (re.compile(r'开光|做法事|请符|画符|供奉化解|驱邪|招魂|通灵作法|养小鬼|下降头|施法改命'), ''),
    (re.compile(r'命中注定|注定难逃|在劫难逃|劫数难逃|命该如此'), '可能'),
    (re.compile(r'克夫|克妻|妨夫|妨妻|克子女|克父母|刑克(?:六亲|父母|配偶|子女)'), '需多留意亲密关系'),
    (re.compile(r'必定会(?:死|亡|离婚|破产|大病|坐牢)|必有血光之灾|必遭横祸|杀身之祸|牢狱之灾|短命|夭折|活不过\S{0,3}岁'), '需多加留意'),
]

TAIL = 10

class Redactor:
    def __init__(self):
        self.pending = ''

    def _clean(self, s: str) -> str:
        for pattern, replacement in REPLACEMENTS:
            s = pattern.sub(replacement, s)
        return s

    def push(self, chunk: str) -> str:
        cleaned = self._clean(self.pending + chunk)
        if len(cleaned) <= TAIL:
            self.pending = cleaned
            return ''
        self.pending = cleaned[len(cleaned) - TAIL:]
        return cleaned[:-TAIL]

    def flush(self) -> str:
        out = self._clean(self.pending)
        self.pending = ''
        return out

MAX_INPUT = 4000

def input_too_long(s: any) -> bool:
    return isinstance(s, str) and len(s) > MAX_INPUT
