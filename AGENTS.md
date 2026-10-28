# AI Photo Editor — agent guide

AI photo enhancement and visual QA service for Airbnb/Vrbo listings. Hosts
upload listing photos; a multi-agent pipeline enhances them while enforcing
listing faithfulness (no invented amenities, no distorted layouts).

Business context: `airbnb_ai_photo_enhancement_blueprint.md` (product, tiers,
architecture) and `pricing-model.md` (pricing and costs).

## Status

Planning only: there is no application code yet. The stack, setup, dev server
and validation commands below are TODO. Fill them in when the project is
scaffolded, since the factory agents read this file for them.

## Stack

TODO

## Setup (fresh checkout)

TODO

## Dev server

TODO (command and how to pick a port; factory jobs pass their own port)

## Validation

TODO (test, lint, type-check and build commands)

## Conventions

- Never let enhancement add, remove or reshape anything in a photo that would
  misrepresent the property.
