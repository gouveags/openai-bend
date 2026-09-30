# Releasing to Bend Hub

The `Release to Bend Hub` GitHub Actions workflow publishes `bend-openai-sdk`
when the `CI` workflow succeeds for a push to `main` and `compatibility.json`
contains an intentional `bend_hub_version` increase from that commit's first
parent. It checks out the exact SHA tested by CI. Pull request runs cannot publish.
An ordinary change that leaves the Hub version unchanged does not publish.

To prepare a release:

1. Increase the four-part `bend_hub_version` (for example, `0.1.0.0` to
   `0.1.0.1`), keeping `bend_hub_name` equal to `bend-openai-sdk`.
2. Update the package documentation, generate `docs.bend`, and run
   `make package-check` with Bend 2.0.34. Set `bend_hub_hash` to the generated
   `build/package.json` hash. Run the full `make test` gate.
3. Merge the version and package changes together to `main` through a PR.
   The release workflow rebuilds the package and requires its hash to match the
   committed metadata before publishing. No provider API key is needed.

A repository administrator must configure the Actions secret `BEND_HUB_TOKEN`
with the Bend Hub login key for the account that owns the package name. Obtain
or refresh that key using `bend login` on a trusted machine. Treat it as a secret;
never paste it into logs, issues, workflow files, or command arguments. The key
may expire or be revoked; replace the repository secret when authentication fails.
The workflow creates `~/.bend/bender.json` with mode `600` only while publishing,
removes the token from the child environment, and removes the file afterward.
Publication output is suppressed to prevent a server error from exposing a key.

Concurrent release jobs are serialized. The workflow reads the public
`https://hub.bend-lang.com/name/bend-openai-sdk@VERSION` resolution before and
after publishing. A rerun skips an existing version with the expected hash and
refuses an existing version with a different hash. A failed publish or mismatched
public resolution fails the job. If upload succeeded but naming failed, rerun
the failed release job after fixing credentials; the CLI can upload the same
content-addressed package again and finish naming it.

Rerun the failed release workflow for the original tested SHA; do not push an
unrelated change expecting it to retry the old version bump. Versions are
immutable and must increase. Actions concurrency may replace pending runs when
several merges arrive together, so check that each intended release completed
before merging the next release bump. The workflow has a ten-minute limit,
publication a five-minute limit, and public lookups a thirty-second limit.

Offline release tests (`bun test tests/release.test.ts`) cover version intent,
identity mismatches, registry errors, idempotent reruns, and final resolution.
They do not establish live credentials, package ownership, or Hub availability.
