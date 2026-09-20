import Base
import ../openai.bend as OpenAI
import ../json.bend as Json
import ./request.bend as Example

def schema() -> Json.Json:
  Json.Object{[
    Json.Field{"type", Json.Text{"object"}},
    Json.Field{"properties", Json.Object{[Json.Field{"city", Json.Object{[Json.Field{"type", Json.Text{"string"}}]}}]}},
    Json.Field{"required", Json.Array{[Json.Text{"city"}]}},
    Json.Field{"additionalProperties", Json.Boolean{False{}}}
  ]}

# This example requests a function call. It does not execute model-chosen code.
def main() -> IO(Unit):
  do IO<Unit>:
    client : OpenAI.Client <- Example.client()
    model : String <- IO.try(String, IO.get_env("OPENAI_MODEL"))
    result : Result<&1, &1, OpenAI.Error, OpenAI.Stream> <- OpenAI.create(
      client, "tools-example",
      OpenAI.Request{model, Json.Text{"What is the weather in Sao Paulo?"}, [
        Json.Field{"tools", Json.Array{[OpenAI.function_tool("weather", "Look up weather for a city", schema())]}},
        Json.Field{"tool_choice", Json.Text{"required"}}
      ]})
    Example.opened(result)
