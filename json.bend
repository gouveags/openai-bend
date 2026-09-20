import Base

# Decimal numbers remain text; objects retain ordering and unknown fields.
type Member<a, -A: Kind(a)> is Kind(a):
  Field{key: String, value: A}

type Json is Data:
  Null{}
  Boolean{value: Bool}
  Number{text: String}
  Text{value: String}
  Array{items: List<&2, Json>}
  Object{fields: List<&2, Member<&2, Json>>}

def hex(n: U32) -> String:
  String.take(String.drop("0123456789abcdef", U32.to_nat(n)), 1n)

def escape_code(control: Bool, +c: U32) -> String:
  match control:
    case True{}:
      "\\u00" ++ hex((c / 16 : U32)) ++ hex((c % 16 : U32))
    case False{}:
      SCon{Chr{c}, SNil{}}

def escape_char(+c: U32) -> String:
  escape_code((c < 32 : U32), c)

def escape_go(s: String, acc: String) -> String:
  match s:
    case SNil{}: String.reverse(acc)
    case SCon{'"', rest}: escape_go(rest, "\"\\" ++ acc)
    case SCon{'\\', rest}: escape_go(rest, "\\\\" ++ acc)
    case SCon{Chr{c}, rest}: escape_go(rest, String.reverse(escape_char(c)) ++ acc)

def escape(s: String) -> String:
  escape_go(s, "")

def quote(s: String) -> String:
  "\"" ++ escape(s) ++ "\""

def comma(empty: Bool) -> String:
  match empty:
    case True{}:
      ""
    case False{}:
      ","

@unsafe
def stringify(value: Json) -> String:
  match value:
    case Null{}:
      "null"
    case Boolean{True{}}:
      "true"
    case Boolean{False{}}:
      "false"
    case Number{text}:
      text
    case Text{value}:
      quote(value)
    case Array{Nil{}}:
      "[]"
    case Array{Con{head, +tail}}:
      "[" ++ stringify(head) ++ comma(List.is_empty(&2, Json, tail)) ++ String.drop(stringify(Array{tail}), 1n)
    case Object{Nil{}}:
      "{}"
    case Object{Con{Field{key, value}, +tail}}:
      "{" ++ quote(key) ++ ":" ++ stringify(value) ++ comma(List.is_empty(&2, Member<&2, Json>, tail)) ++ String.drop(stringify(Object{tail}), 1n)

def choose(found: Bool, value: Json, other: Maybe<&2, Json>) -> Maybe<&2, Json>:
  match found:
    case True{}:
      Some{value}
    case False{}:
      other

def get_fields(fields: List<&2, Member<&2, Json>>, +key: String) -> Maybe<&2, Json>:
  match fields:
    case Nil{}:
      None{}
    case Con{Field{name, value}, tail}:
      choose(String.eq(name, key), value, get_fields(tail, key))

def get(value: Json, key: String) -> Maybe<&2, Json>:
  match value:
    case Object{fields}:
      get_fields(fields, key)
    case _:
      None{}

def text(value: Maybe<&2, Json>) -> String:
  match value:
    case Some{Text{s}}:
      s
    case _:
      ""

type Token is Data:
  Atom{value: Json}
  OpenArray{}
  CloseArray{}
  OpenObject{}
  CloseObject{}
  Colon{}
  Comma{}

def select_u32(ok: Bool, yes: U32, no: U32) -> U32:
  match ok:
    case True{}: yes
    case False{}: no

def hex_digit(ch: Char) -> U32:
  +c = Char.to_u32(ch)
  select_u32((c >= 48 : U32) && (c <= 57 : U32), (c - 48 : U32),
    select_u32((c >= 97 : U32) && (c <= 102 : U32), (c - 87 : U32),
      select_u32((c >= 65 : U32) && (c <= 70 : U32), (c - 55 : U32), 256)))

def checked_char(ok: Bool, code: U32) -> Result<&1, &1, String, Char>:
  match ok:
    case True{}: Done{Chr{code}}
    case False{}: Fail{"invalid JSON Unicode escape"}

def hex_checked(ok: Bool, code: U32) -> Result<&1, &1, String, U32>:
  match ok:
    case True{}: Done{code}
    case False{}: Fail{"invalid JSON Unicode escape"}

def hex4(+a: U32, +b: U32, +c: U32, +d: U32) -> Result<&1, &1, String, U32>:
  hex_checked((a < 16 : U32) && (b < 16 : U32) && (c < 16 : U32) && (d < 16 : U32), (a * 4096 + b * 256 + c * 16 + d : U32))

def unicode_escape(high: Bool, +code: U32, rest: String) -> Result<&1, &1, String, Char & String>:
  match high:
    case True{}:
      match rest:
        case SCon{'\\', SCon{'u', SCon{a, SCon{b, SCon{c, SCon{d, tail}}}}}}:
          do Result<&1, &1, String, Char & String>:
            +low : U32 <- hex4(hex_digit(a), hex_digit(b), hex_digit(c), hex_digit(d))
            ch : Char <- checked_char((low >= 56320 : U32) && (low <= 57343 : U32), (65536 + (code - 55296) * 1024 + low - 56320 : U32))
            return (ch, tail)
        case _: Fail{"unpaired JSON surrogate"}
    case False{}:
      do Result<&1, &1, String, Char & String>:
        ch : Char <- checked_char((code < 55296 : U32) || (code > 57343 : U32), code)
        return (ch, rest)

def unicode_escape_code(result: Result<&1, &1, String, U32>, rest: String) -> Result<&1, &1, String, Char & String>:
  match result:
    case Fail{e}: Fail{e}
    case Done{+code}: unicode_escape((code >= 55296 : U32) && (code <= 56319 : U32), code, rest)

def unescape(s: String) -> Result<&1, &1, String, Char & String>:
  match s:
    case SCon{'"', rest}: Done{('"', rest)}
    case SCon{'\\', rest}: Done{('\\', rest)}
    case SCon{'/', rest}: Done{('/', rest)}
    case SCon{'b', rest}: Done{(Chr{8}, rest)}
    case SCon{'f', rest}: Done{(Chr{12}, rest)}
    case SCon{'n', rest}: Done{('\n', rest)}
    case SCon{'r', rest}: Done{('\r', rest)}
    case SCon{'t', rest}: Done{('\t', rest)}
    case SCon{'u', SCon{a, SCon{b, SCon{c, SCon{d, rest}}}}}:
      unicode_escape_code(hex4(hex_digit(a), hex_digit(b), hex_digit(c), hex_digit(d)), rest)
    case _: Fail{"invalid JSON escape"}

def string_char(ok: Bool, ch: Char, rest: String, acc: String,
                next: String -> String -> Result<&1, &1, String, String & String>) -> Result<&1, &1, String, String & String>:
  match ok:
    case True{}: next(rest, SCon{ch, acc})
    case False{}: Fail{"unescaped control character"}

def string_escape(result: Result<&1, &1, String, Char & String>, acc: String,
                  next: String -> String -> Result<&1, &1, String, String & String>) -> Result<&1, &1, String, String & String>:
  match result:
    case Fail{e}: Fail{e}
    case Done{(ch, rest)}: next(rest, SCon{ch, acc})

def string_read(fuel: Nat, s: String, acc: String) -> Result<&1, &1, String, String & String>:
  match fuel:
    case 0n: Fail{"JSON string limit"}
    case 1n+n:
      match s:
        case SNil{}: Fail{"unterminated JSON string"}
        case SCon{'"', rest}: Done{(String.reverse(acc), rest)}
        case SCon{'\\', rest}:
          string_escape(unescape(rest), acc, r => a => string_read(n, r, a))
        case SCon{Chr{+c}, rest}:
          string_char((c >= 32 : U32), Chr{c}, rest, acc, r => a => string_read(n, r, a))

# Number states avoid matching U32 bit constructors in the parser.
type NumberState is Data:
  Start{}
  Minus{}
  Zero{}
  Integer{}
  Dot{}
  Fraction{}
  Exponent{}
  Sign{}
  Digits{}
  Bad{}

def select_state(ok: Bool, yes: NumberState, no: NumberState) -> NumberState:
  match ok:
    case True{}: yes
    case False{}: no

def number_state(state: NumberState, +ch: Char) -> NumberState:
  match state:
    case Start{}: select_state(Char.is_eq(ch, '-'), Minus{}, select_state(Char.is_eq(ch, '0'), Zero{}, select_state(Char.is_digit(ch), Integer{}, Bad{})))
    case Minus{}: select_state(Char.is_eq(ch, '0'), Zero{}, select_state(Char.is_digit(ch), Integer{}, Bad{}))
    case Zero{}: select_state(Char.is_eq(ch, '.'), Dot{}, select_state(Char.is_eq(ch, 'e') || Char.is_eq(ch, 'E'), Exponent{}, Bad{}))
    case Integer{}: select_state(Char.is_digit(ch), Integer{}, select_state(Char.is_eq(ch, '.'), Dot{}, select_state(Char.is_eq(ch, 'e') || Char.is_eq(ch, 'E'), Exponent{}, Bad{})))
    case Dot{}: select_state(Char.is_digit(ch), Fraction{}, Bad{})
    case Fraction{}: select_state(Char.is_digit(ch), Fraction{}, select_state(Char.is_eq(ch, 'e') || Char.is_eq(ch, 'E'), Exponent{}, Bad{}))
    case Exponent{}: select_state(Char.is_eq(ch, '+') || Char.is_eq(ch, '-'), Sign{}, select_state(Char.is_digit(ch), Digits{}, Bad{}))
    case Sign{}: select_state(Char.is_digit(ch), Digits{}, Bad{})
    case Digits{}: select_state(Char.is_digit(ch), Digits{}, Bad{})
    case Bad{}: Bad{}

def number_end(state: NumberState) -> Bool:
  match state:
    case Zero{}: True{}
    case Integer{}: True{}
    case Fraction{}: True{}
    case Digits{}: True{}
    case _: False{}

def number_valid(s: String, state: NumberState) -> Bool:
  match s:
    case SNil{}: number_end(state)
    case SCon{ch, rest}: number_valid(rest, number_state(state, ch))

def primitive(ok: Bool, raw: String) -> Result<&1, &1, String, Token>:
  match ok:
    case True{}: Done{Atom{Number{raw}}}
    case False{}: Fail{"invalid JSON literal"}

def literal_known(is_null: Bool, is_true: Bool, is_false: Bool, +raw: String) -> Result<&1, &1, String, Token>:
  match is_null is_true is_false:
    case True{} _ _: Done{Atom{Null{}}}
    case _ True{} _: Done{Atom{Boolean{True{}}}}
    case _ _ True{}: Done{Atom{Boolean{False{}}}}
    case _ _ _: primitive(number_valid(raw, Start{}), raw)

def literal(+raw: String) -> Result<&1, &1, String, Token>:
  literal_known(String.eq(raw, "null"), String.eq(raw, "true"), String.eq(raw, "false"), raw)

def delimiter(+c: Char) -> Bool:
  Char.is_eq(c, ' ') || Char.is_eq(c, '\n') || Char.is_eq(c, '\r') || Char.is_eq(c, '\t') || Char.is_eq(c, ',') || Char.is_eq(c, ']') || Char.is_eq(c, '}')

def word_step(stop: Bool, c: Char, rest: String, acc: String,
              next: String -> String -> String & String) -> String & String:
  match stop:
    case True{}: (String.reverse(acc), SCon{c, rest})
    case False{}: next(rest, SCon{c, acc})

def word(s: String, acc: String) -> String & String:
  match s:
    case SNil{}: (String.reverse(acc), "")
    case SCon{+c, +rest}: word_step(delimiter(c), c, rest, acc, r => a => word(rest, a))

def lex_string(result: Result<&1, &1, String, String & String>,
               next: String -> Maybe<&2, Token> -> Result<&1, &1, String, List<&2, Token>>) -> Result<&1, &1, String, List<&2, Token>>:
  match result:
    case Fail{e}: Fail{e}
    case Done{(s, rest)}: next(rest, Some{Atom{Text{s}}})

def lex_word(pair: String & String,
             next: String -> Maybe<&2, Token> -> Result<&1, &1, String, List<&2, Token>>) -> Result<&1, &1, String, List<&2, Token>>:
  (raw, rest) = pair
  do Result<&1, &1, String, List<&2, Token>>:
    token : Token <- literal(raw)
    next(rest, Some{token})

type LexKind is Data:
  Space{}
  LArray{}
  RArray{}
  LObject{}
  RObject{}
  LColon{}
  LComma{}
  Quote{}
  Other{}

def select_lex(ok: Bool, yes: LexKind, no: LexKind) -> LexKind:
  match ok:
    case True{}: yes
    case False{}: no

def lex_kind(+c: Char) -> LexKind:
  select_lex(Char.is_eq(c, ' ') || Char.is_eq(c, '\n') || Char.is_eq(c, '\r') || Char.is_eq(c, '\t'), Space{},
    select_lex(Char.is_eq(c, '['), LArray{}, select_lex(Char.is_eq(c, ']'), RArray{},
    select_lex(Char.is_eq(c, '{'), LObject{}, select_lex(Char.is_eq(c, '}'), RObject{},
    select_lex(Char.is_eq(c, ':'), LColon{}, select_lex(Char.is_eq(c, ','), LComma{},
    select_lex(Char.is_eq(c, '"'), Quote{}, Other{}))))))))

def lex_step(kind: LexKind, c: Char, +rest: String,
             next: String -> Maybe<&2, Token> -> Result<&1, &1, String, List<&2, Token>>) -> Result<&1, &1, String, List<&2, Token>>:
  match kind:
    case Space{}: next(rest, None{})
    case LArray{}: next(rest, Some{OpenArray{}})
    case RArray{}: next(rest, Some{CloseArray{}})
    case LObject{}: next(rest, Some{OpenObject{}})
    case RObject{}: next(rest, Some{CloseObject{}})
    case LColon{}: next(rest, Some{Colon{}})
    case LComma{}: next(rest, Some{Comma{}})
    case Quote{}: lex_string(string_read(1n+String.length(rest), rest, ""), next)
    case Other{}: lex_word(word(SCon{c, rest}, ""), next)

def lex_acc(token: Maybe<&2, Token>, acc: List<&2, Token>) -> List<&2, Token>:
  match token:
    case None{}: acc
    case Some{t}: Con{t, acc}

def lex(fuel: Nat, s: String, acc: List<&2, Token>) -> Result<&1, &1, String, List<&2, Token>>:
  match fuel:
    case 0n: Fail{"JSON token limit"}
    case 1n+n:
      match s:
        case SNil{}: Done{List.reverse(&2, Token, acc)}
        case SCon{+c, rest}: lex_step(lex_kind(c), c, rest, r => t => lex(n, r, lex_acc(t, acc)))

type Parse is Type:
  Parsed{value: Json, rest: List<&2, Token>}
  Invalid{message: String}

type Mode is Data:
  Value{}
  Elements{acc: List<&2, Json>, empty: Bool}
  Fields{acc: List<&2, Member<&2, Json>>, empty: Bool}

def array_end(ok: Bool, acc: List<&2, Json>, rest: List<&2, Token>) -> Parse:
  match ok:
    case True{}: Parsed{Array{List.reverse(&2, Json, acc)}, rest}
    case False{}: Invalid{"trailing array comma"}

def object_end(ok: Bool, acc: List<&2, Member<&2, Json>>, rest: List<&2, Token>) -> Parse:
  match ok:
    case True{}: Parsed{Object{List.reverse(&2, Member<&2, Json>, acc)}, rest}
    case False{}: Invalid{"trailing object comma"}

def array_after(result: Parse, acc: List<&2, Json>, next: Mode -> List<&2, Token> -> Parse) -> Parse:
  match result:
    case Invalid{e}: Invalid{e}
    case Parsed{value, Con{Comma{}, rest}}: next(Elements{Con{value, acc}, False{}}, rest)
    case Parsed{value, Con{CloseArray{}, rest}}: array_end(True{}, Con{value, acc}, rest)
    case Parsed{value, rest}: Invalid{"expected array comma or closing bracket"}

def object_after(result: Parse, key: String, acc: List<&2, Member<&2, Json>>, next: Mode -> List<&2, Token> -> Parse) -> Parse:
  match result:
    case Invalid{e}: Invalid{e}
    case Parsed{value, Con{Comma{}, rest}}: next(Fields{Con{Field{key, value}, acc}, False{}}, rest)
    case Parsed{value, Con{CloseObject{}, rest}}: object_end(True{}, Con{Field{key, value}, acc}, rest)
    case Parsed{value, rest}: Invalid{"expected object comma or closing brace"}

def parse(fuel: Nat, mode: Mode, tokens: List<&2, Token>) -> Parse:
  match fuel:
    case 0n: Invalid{"JSON nesting or token limit"}
    case 1n+ +n:
      match mode tokens:
        case Value{} Con{Atom{value}, rest}: Parsed{value, rest}
        case Value{} Con{OpenArray{}, rest}: parse(n, Elements{Nil{}, True{}}, rest)
        case Value{} Con{OpenObject{}, rest}: parse(n, Fields{Nil{}, True{}}, rest)
        case Elements{acc, empty} Con{CloseArray{}, rest}: array_end(empty, acc, rest)
        case Elements{acc, empty} ts: array_after(parse(n, Value{}, ts), acc, m => t => parse(n, m, t))
        case Fields{acc, empty} Con{CloseObject{}, rest}: object_end(empty, acc, rest)
        case Fields{acc, empty} Con{Atom{Text{key}}, Con{Colon{}, rest}}:
          object_after(parse(n, Value{}, rest), key, acc, m => t => parse(n, m, t))
        case _ _: Invalid{"expected JSON value or object key"}

def finish(result: Parse) -> Result<&1, &1, String, Json>:
  match result:
    case Invalid{e}: Fail{e}
    case Parsed{value, Nil{}}: Done{value}
    case Parsed{value, rest}: Fail{"trailing JSON tokens"}

def depth_guard(ok: Bool, depth: U32, next: U32 -> Bool) -> Bool:
  match ok:
    case True{}: next(depth)
    case False{}: False{}

def depth_step(token: Token, +depth: U32, next: U32 -> Bool) -> Bool:
  match token:
    case OpenArray{}: depth_guard((depth < 64 : U32), (depth + 1 : U32), next)
    case OpenObject{}: depth_guard((depth < 64 : U32), (depth + 1 : U32), next)
    case CloseArray{}: depth_guard((depth > 0 : U32), (depth - 1 : U32), next)
    case CloseObject{}: depth_guard((depth > 0 : U32), (depth - 1 : U32), next)
    case _: next(depth)

def depth_valid(tokens: List<&2, Token>, depth: U32) -> Bool:
  match tokens:
    case Nil{}: U32.is_eq(depth, 0)
    case Con{token, rest}: depth_step(token, depth, d => depth_valid(rest, d))

def token_count(tokens: List<&2, Token>, count: U32) -> U32:
  match tokens:
    case Nil{}: count
    case Con{token, rest}: token_count(rest, (count + 1 : U32))

def parse_checked(ok: Bool, count: U32, tokens: List<&2, Token>) -> Result<&1, &1, String, Json>:
  match ok:
    case False{}: Fail{"JSON exceeds 64 nesting levels or 65536 tokens, or has unmatched brackets"}
    case True{}: finish(parse(1n+U32.to_nat(count), Value{}, tokens))

def parse_tokens(+tokens: List<&2, Token>) -> Result<&1, &1, String, Json>:
  +count = token_count(tokens, 0)
  parse_checked(depth_valid(tokens, 0) && (count <= 65536 : U32), count, tokens)

def read(+s: String) -> Result<&1, &1, String, Json>:
  do Result<&1, &1, String, Json>:
    tokens : List<&2, Token> <- lex(1n+String.length(s), s, Nil{})
    parse_tokens(tokens)
