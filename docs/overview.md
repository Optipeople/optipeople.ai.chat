# OptiAI Chat — Overview

## What this is

OptiAI Chat is an extension to the **Optipeople** platform, our MES / digital
operations platform for factories. Where Optipeople covers the broader
production, people, and operations layer of a factory, this app focuses
specifically on giving **machine operators on the shop floor** an AI assistant
they can reach for the moment something goes wrong at their machine.

## The problem we're solving

When a machine stops or throws an error code, the operator today has a few
options, all of them slow:

- Dig through paper or PDF manuals to find the relevant section.
- Look up technical drawings or internal instructions scattered across
  systems.
- Call the machine builder's support line and wait for a response.

Every one of those paths costs production time. The machine is down while the
operator is hunting for information, and the operator often isn't the person
best equipped to interpret a dense service manual under pressure.

## What the app does

OptiAI Chat gives the operator a single place to ask: a chat interface they
can open right at the machine. Behind the chat sits:

1. **A per-machine knowledge base** — manuals, technical drawings,
   instructions, error-code references, maintenance history, and any other
   documentation tied to that specific machine.
2. **An AI assistant** that combines this knowledge base with its own general
   technical knowledge to guide the operator through the issue.
3. **An escalation path** — if the AI can't resolve the problem, the
   conversation can be handed off to a human support team (internal
   maintenance, the machine builder, or another designated responder) with
   the full context of what has already been tried.

The goal is that the operator does not have to leave the chat, and does not
have to become a documentation archaeologist, to get back into production.

## Why it fits inside Optipeople

Optipeople already knows which operator is at which machine, what is being
produced, and what the operational context looks like. OptiAI Chat plugs into
that: the assistant isn't a generic chatbot — it knows *which* machine the
operator is standing in front of, and scopes its answers and its knowledge
base accordingly.

## Success looks like

- Operators resolve more machine issues on their own, faster, without
  escalating.
- When escalation *is* needed, the support team starts with full context
  instead of a cold call.
- Tribal knowledge about machines (fixes, workarounds, recurring faults)
  accumulates in the knowledge base instead of living only in a few
  technicians' heads.
