import Base
import ../openai.bend as OpenAI
import ../json.bend as Json

def summary(response: OpenAI.Response) -> String:
  match response:
    case OpenAI.Response{id, status, text, calls, usage, raw}:
      id ++ "|" ++ status ++ "|" ++ text ++ "|" ++ Nat.show(List.length(&2, OpenAI.FunctionCall, calls)) ++ "|" ++ Json.stringify(raw)

def parsed(result: Result<&1, &1, String, Json.Json>) -> IO(Unit):
  match result:
    case Fail{e}: IO.die(Unit, 1, e)
    case Done{value}: IO.print(summary(OpenAI.response(value)))

def argument(args: List<&1, String>) -> IO(Unit):
  match args:
    case Con{s, Nil{}}: parsed(Json.read(s))
    case _: IO.die(Unit, 1, "expected response JSON")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<&1, String> <- IO.args()
    argument(args)
