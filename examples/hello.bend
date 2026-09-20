import Base
import ../openai.bend as OpenAI
import ./request.bend as Example

def main() -> IO(Unit):
  do IO<Unit>:
    client : OpenAI.Client <- Example.client()
    model : String <- IO.try(String, IO.get_env("OPENAI_MODEL"))
    result : Result<&1, &1, OpenAI.Error, OpenAI.Stream> <- OpenAI.create(
      client, "hello-example", OpenAI.text_request(model, "Say hello in one sentence."))
    Example.opened(result)
