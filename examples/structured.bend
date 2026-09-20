import Base
import ../openai.bend as OpenAI
import ../json.bend as Json
import ./request.bend as Example

def schema() -> Json.Json:
  Json.Object{[
    Json.Field{"type", Json.Text{"object"}},
    Json.Field{"properties", Json.Object{[Json.Field{"name", Json.Object{[Json.Field{"type", Json.Text{"string"}}]}}]}},
    Json.Field{"required", Json.Array{[Json.Text{"name"}]}},
    Json.Field{"additionalProperties", Json.Boolean{False{}}}
  ]}

def main() -> IO(Unit):
  do IO<Unit>:
    client : OpenAI.Client <- Example.client()
    model : String <- IO.try(String, IO.get_env("OPENAI_MODEL"))
    result : Result<&1, &1, OpenAI.Error, OpenAI.Stream> <- OpenAI.create(
      client, "structured-example",
      OpenAI.Request{model, Json.Text{"Extract the name: Ada wrote this."},
        [Json.Field{"text", OpenAI.json_schema("person", schema())}]})
    Example.opened(result)
