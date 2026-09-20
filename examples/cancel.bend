import Base
import ../openai.bend as OpenAI
import ./request.bend as Example

def started(result: Result<&1, &1, OpenAI.Error, OpenAI.Stream>, client: OpenAI.Client) -> IO(Unit):
  match result:
    case Fail{OpenAI.Error{code, message, status, request_id, retry_after}}: IO.die(Unit, 1, message)
    case Done{stream}:
      do IO<Unit>:
        IO.sleep(50)
        ack : Result<&1, &1, String, Bool> <- OpenAI.cancel(client, "cancel-example")
        Example.consume(stream)

def main() -> IO(Unit):
  do IO<Unit>:
    +client : OpenAI.Client <- Example.client()
    model : String <- IO.try(String, IO.get_env("OPENAI_MODEL"))
    result : Result<&1, &1, OpenAI.Error, OpenAI.Stream> <- OpenAI.create(client, "cancel-example", OpenAI.text_request(model, "slow"))
    started(result, client)
