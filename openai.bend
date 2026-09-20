# An unofficial OpenAI SDK for Bend, with typed requests, streaming, and tool calling.

import Base
import ./json.bend as J
import ./transport.bend as T
import ./docs.bend as Docs

def repository() -> String:
  Docs.repository()

def version() -> String:
  Docs.version()

type Client is Data:
  Client{port: U32, token: String}

type Request is Data:
  Request{model: String, input: J.Json, options: List<&2, J.Member<&2, J.Json>>}

type Error is Data:
  Error{code: String, message: String, status: String, request_id: String, retry_after: String}

type Stream is Type:
  Stream{connection: T.Connection, id: String, terminal: Bool}

type Step is Type:
  Event{stream: Stream, kind: String, data: J.Json, request_id: String}
  Finished{}
  Failed{error: Error}

def text_request(model: String, input: String) -> Request:
  Request{model, J.Text{input}, Nil{}}

def params(request: Request) -> J.Json:
  match request:
    case Request{model, input, options}:
      J.Object{Con{J.Field{"model", J.Text{model}}, Con{J.Field{"input", input}, options}}}

def envelope(client: Client, id: String, stream: Bool, body: J.Json, operation: String) -> J.Json:
  match client:
    case Client{port, token}:
      J.Object{[J.Field{"version", J.Number{"1"}}, J.Field{"token", J.Text{token}}, J.Field{"id", J.Text{id}}, J.Field{"operation", J.Text{operation}}, J.Field{"stream", J.Boolean{stream}}, J.Field{"params", body}]}

def opened(result: Result<&1, &1, String, T.Connection>, id: String) -> Result<&1, &1, Error, Stream>:
  match result:
    case Fail{message}: Fail{Error{"transport_error", message, "0", "", ""}}
    case Done{connection}: Done{Stream{connection, id, False{}}}

def open_raw(+client: Client, +id: String, stream: Bool, body: J.Json) -> IO(Result<&1, &1, Error, Stream>):
  match client:
    case Client{port, token}:
      do IO<Result<&1, &1, Error, Stream>>:
        result : Result<&1, &1, String, T.Connection> <- T.connect(port, J.stringify(envelope(client, id, stream, body, "responses.create")))
        return opened(result, id)

def create(client: Client, id: String, request: Request) -> IO(Result<&1, &1, Error, Stream>):
  open_raw(client, id, False{}, params(request))

def stream(client: Client, id: String, request: Request) -> IO(Result<&1, &1, Error, Stream>):
  open_raw(client, id, True{}, params(request))

def close(stream: Stream) -> IO(Unit):
  match stream:
    case Stream{connection, id, terminal}: T.close(connection)

def field(+frame: J.Json, key: String) -> String:
  J.text(J.get(frame, key))

def value_or_null(value: Maybe<&2, J.Json>) -> J.Json:
  match value:
    case Some{v}: v
    case None{}: J.Null{}

def json_field(frame: J.Json, key: String) -> J.Json:
  value_or_null(J.get(frame, key))

def fail(connection: T.Connection, code: String, message: String) -> IO(Step):
  do IO<Step>:
    T.close(connection)
    return Failed{Error{code, message, "0", "", ""}}

def finish(ok: Bool, connection: T.Connection) -> IO(Step):
  match ok:
    case True{}:
      do IO<Step>:
        T.close(connection)
        return Finished{}
    case False{}: fail(connection, "truncated_stream", "No result or terminal response event")

def terminal_type(+name: String) -> Bool:
  String.eq(name, "response.completed") || String.eq(name, "response.failed") || String.eq(name, "response.incomplete") || String.eq(name, "error")

def status(value: J.Json) -> String:
  match value:
    case J.Number{s}: s
    case _: "0"

type FrameKind is Data:
  EndFrame{}
  ErrorFrame{}
  ResultFrame{}
  MetadataFrame{}
  EventFrame{}
  UnknownFrame{}

def select_kind(ok: Bool, yes: FrameKind, no: FrameKind) -> FrameKind:
  match ok:
    case True{}: yes
    case False{}: no

def frame_kind(+kind: String) -> FrameKind:
  select_kind(String.eq(kind, "end"), EndFrame{}, select_kind(String.eq(kind, "error"), ErrorFrame{},
    select_kind(String.eq(kind, "result"), ResultFrame{}, select_kind(String.eq(kind, "metadata"), MetadataFrame{},
    select_kind(String.eq(kind, "event"), EventFrame{}, UnknownFrame{})))))

def step_kind(kind: FrameKind, connection: T.Connection, id: String, terminal: Bool, +frame: J.Json) -> IO(Step):
  match kind:
    case EndFrame{}: finish(terminal, connection)
    case ErrorFrame{}:
      do IO<Step>:
        T.close(connection)
        return Failed{Error{field(frame, "code"), field(frame, "message"), status(json_field(frame, "status")), field(frame, "request_id"), field(frame, "retry_after")}}
    case ResultFrame{}: IO.pure(Step, Event{Stream{connection, id, True{}}, "result", json_field(frame, "data"), field(frame, "request_id")})
    case MetadataFrame{}: IO.pure(Step, Event{Stream{connection, id, terminal}, "metadata", frame, field(frame, "request_id")})
    case EventFrame{}:
      +data = json_field(frame, "data")
      +name = field(data, "type")
      IO.pure(Step, Event{Stream{connection, id, terminal || terminal_type(name)}, name, data, ""})
    case _: fail(connection, "protocol", "Unknown bridge frame kind")

def step_id(ok: Bool, connection: T.Connection, id: String, terminal: Bool, +frame: J.Json) -> IO(Step):
  match ok:
    case True{}: step_kind(frame_kind(field(frame, "kind")), connection, id, terminal, frame)
    case False{}: fail(connection, "protocol", "Mismatched bridge request id")

def received(result: T.Read, +id: String, terminal: Bool) -> IO(Step):
  match result:
    case T.Broken{message}: IO.pure(Step, Failed{Error{"transport_error", message, "0", "", ""}})
    case T.Frame{connection, +frame}: step_id(String.eq(field(frame, "id"), id), connection, id, terminal, frame)

def next(stream: Stream) -> IO(Step):
  match stream:
    case Stream{connection, id, terminal}:
      do IO<Step>:
        result : T.Read <- T.read(connection)
        received(result, id, terminal)

def cancelled(kind: Bool, value: J.Json) -> Result<&1, &1, String, Bool>:
  match kind value:
    case True{} J.Boolean{found}: Done{found}
    case _ _: Fail{"Cancellation rejected by bridge"}

def cancel_read(result: T.Read) -> IO(Result<&1, &1, String, Bool>):
  match result:
    case T.Broken{message}: IO.pure(Result<&1, &1, String, Bool>, Fail{message})
    case T.Frame{connection, +frame}:
      do IO<Result<&1, &1, String, Bool>>:
        T.close(connection)
        return cancelled(String.eq(field(frame, "kind"), "cancelled"), json_field(frame, "found"))

def cancel_open(result: Result<&1, &1, String, T.Connection>) -> IO(Result<&1, &1, String, Bool>):
  match result:
    case Fail{e}: IO.pure(Result<&1, &1, String, Bool>, Fail{e})
    case Done{connection}:
      do IO<Result<&1, &1, String, Bool>>:
        result : T.Read <- T.read(connection)
        cancel_read(result)

def cancel(+client: Client, id: String) -> IO(Result<&1, &1, String, Bool>):
  match client:
    case Client{port, token}:
      do IO<Result<&1, &1, String, Bool>>:
        result : Result<&1, &1, String, T.Connection> <- T.connect(port, J.stringify(envelope(client, id, False{}, J.Null{}, "cancel")))
        cancel_open(result)

def function_tool(name: String, description: String, schema: J.Json) -> J.Json:
  J.Object{[J.Field{"type", J.Text{"function"}}, J.Field{"name", J.Text{name}}, J.Field{"description", J.Text{description}}, J.Field{"parameters", schema}, J.Field{"strict", J.Boolean{True{}}}]}

def function_output(call_id: String, output: String) -> J.Json:
  J.Object{[J.Field{"type", J.Text{"function_call_output"}}, J.Field{"call_id", J.Text{call_id}}, J.Field{"output", J.Text{output}}]}

def json_schema(name: String, schema: J.Json) -> J.Json:
  J.Object{[J.Field{"format", J.Object{[J.Field{"type", J.Text{"json_schema"}}, J.Field{"name", J.Text{name}}, J.Field{"strict", J.Boolean{True{}}}, J.Field{"schema", schema}]}}]}

type Usage is Data:
  Usage{input_tokens: String, output_tokens: String, total_tokens: String}

type FunctionCall is Data:
  FunctionCall{id: String, call_id: String, name: String, arguments: String, raw: J.Json}

type Response is Data:
  Response{id: String, status: String, text: String, calls: List<&2, FunctionCall>, usage: Maybe<&2, Usage>, raw: J.Json}

def array(value: J.Json) -> List<&2, J.Json>:
  match value:
    case J.Array{items}: items
    case _: Nil{}

def content_piece(kind: Bool, item: J.Json) -> String:
  match kind:
    case True{}: field(item, "text")
    case _: ""

def content_text(items: List<&2, J.Json>) -> String:
  match items:
    case Nil{}: ""
    case Con{+item, rest}: content_piece(String.eq(field(item, "type"), "output_text"), item) ++ content_text(rest)

def output_text(items: List<&2, J.Json>) -> String:
  match items:
    case Nil{}: ""
    case Con{item, rest}: content_text(array(json_field(item, "content"))) ++ output_text(rest)

def call_piece(kind: Bool, +item: J.Json, rest: List<&2, FunctionCall>) -> List<&2, FunctionCall>:
  match kind:
    case True{}: Con{FunctionCall{field(item, "id"), field(item, "call_id"), field(item, "name"), field(item, "arguments"), item}, rest}
    case _: rest

def function_calls(items: List<&2, J.Json>) -> List<&2, FunctionCall>:
  match items:
    case Nil{}: Nil{}
    case Con{+item, rest}: call_piece(String.eq(field(item, "type"), "function_call"), item, function_calls(rest))

def usage(value: J.Json) -> Maybe<&2, Usage>:
  match value:
    case J.Null{}: None{}
    case J.Object{+fields}: Some{Usage{status(value_or_null(J.get_fields(fields, "input_tokens"))), status(value_or_null(J.get_fields(fields, "output_tokens"))), status(value_or_null(J.get_fields(fields, "total_tokens")))}}
    case _: None{}

def response(+raw: J.Json) -> Response:
  Response{field(raw, "id"), field(raw, "status"), output_text(array(json_field(raw, "output"))), function_calls(array(json_field(raw, "output"))), usage(json_field(raw, "usage")), raw}
