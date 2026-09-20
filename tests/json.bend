import Base
import ../json.bend as J

def output(result: Result<&1, &1, String, J.Json>) -> IO(Unit):
  match result:
    case Done{value}: IO.print(J.stringify(value))
    case Fail{error}: IO.die(Unit, 1, error)

def argument(args: List<&1, String>) -> IO(Unit):
  match args:
    case Con{s, Nil{}}: output(J.read(s))
    case _: IO.die(Unit, 1, "expected one JSON argument")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<&1, String> <- IO.args()
    argument(args)
