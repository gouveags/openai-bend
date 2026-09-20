import Base
import ../openai.bend as OpenAI
import ../json.bend as Json

def failed_status(+status: String) -> Bool:
  String.eq(status, "failed") || String.eq(status, "incomplete")

def provider_failed(+kind: String, data: Json.Json) -> Bool:
  String.eq(kind, "error") || String.eq(kind, "response.failed") ||
    String.eq(kind, "response.incomplete") ||
    (String.eq(kind, "result") && failed_status(OpenAI.field(data, "status")))

def print_event(failed: Bool, stream: OpenAI.Stream, kind: String, data: Json.Json,
                next: OpenAI.Stream -> IO(Unit)) -> IO(Unit):
  match failed:
    case True{}:
      do IO<Unit>:
        OpenAI.close(stream)
        IO.die(Unit, 1, "provider_error: " ++ Json.stringify(data))
    case False{}:
      do IO<Unit>:
        IO.print(kind ++ " " ++ Json.stringify(data))
        next(stream)

def print_step(step: OpenAI.Step, next: OpenAI.Stream -> IO(Unit)) -> IO(Unit):
  match step:
    case OpenAI.Finished{}: IO.print("finished")
    case OpenAI.Failed{OpenAI.Error{code, message, status, request_id, retry_after}}:
      IO.die(Unit, 1, code ++ ": " ++ message)
    case OpenAI.Event{stream, +kind, +data, request_id}:
      print_event(provider_failed(kind, data), stream, kind, data, next)

@unsafe
def consume(stream: OpenAI.Stream) -> IO(Unit):
  do IO<Unit>:
    step : OpenAI.Step <- OpenAI.next(stream)
    print_step(step, s => consume(s))

def opened(result: Result<&1, &1, OpenAI.Error, OpenAI.Stream>) -> IO(Unit):
  match result:
    case Fail{OpenAI.Error{code, message, status, request_id, retry_after}}: IO.die(Unit, 1, message)
    case Done{stream}: consume(stream)

def run(port: U32, token: String, id: String, stream: Bool, body: Json.Json) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1, &1, OpenAI.Error, OpenAI.Stream> <- OpenAI.open_raw(OpenAI.Client{port, token}, id, stream, body)
    opened(result)

def body_read(result: Result<&1, &1, String, Json.Json>, port: U32, token: String, id: String, stream: Bool) -> IO(Unit):
  match result:
    case Fail{message}: IO.die(Unit, 1, message)
    case Done{body}: run(port, token, id, stream, body)

def port_read(port: Maybe<&2, U32>, token: String, args: List<&1, String>) -> IO(Unit):
  match port args:
    case Some{port} Con{id, Con{stream, Con{json, Nil{}}}}:
      body_read(Json.read(json), port, token, id, String.eq(stream, "stream"))
    case _ _: IO.die(Unit, 1, "Usage: request REQUEST_ID stream|once JSON (set OPENAI_BEND_PORT and OPENAI_BEND_TOKEN)")

def main() -> IO(Unit):
  do IO<Unit>:
    port : String <- IO.try(String, IO.get_env("OPENAI_BEND_PORT"))
    token : String <- IO.try(String, IO.get_env("OPENAI_BEND_TOKEN"))
    args : List<&1, String> <- IO.args()
    port_read(U32.read(port), token, args)

def client_port(port: Maybe<&2, U32>, token: String) -> IO(OpenAI.Client):
  match port:
    case Some{port}: IO.pure(OpenAI.Client, OpenAI.Client{port, token})
    case None{}: IO.die(OpenAI.Client, 1, "Invalid OPENAI_BEND_PORT")

def client() -> IO(OpenAI.Client):
  do IO<OpenAI.Client>:
    port : String <- IO.try(String, IO.get_env("OPENAI_BEND_PORT"))
    token : String <- IO.try(String, IO.get_env("OPENAI_BEND_TOKEN"))
    client_port(U32.read(port), token)
