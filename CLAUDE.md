# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MECCG is a web-based implementation of the Middle-Earth Collectible Card Game (MECCG). It uses a client/server architecture where the server manages game state and rules enforcement, and the client provides the browser-based UI.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js
- **Architecture:** Client/server
  - **Server:** Game engine, state management, rules enforcement, WebSocket API
  - **Client:** Browser-based UI communicating with the server over WebSockets

## Build & Development Commands

*To be filled in as tooling is set up (package manager, bundler, test framework, etc.)*

## Architecture

*To be updated as the codebase evolves.*

### Key Design Principles

- The server is the authority on game state — clients never modify state directly
- Game rules are enforced server-side; the client is a presentation layer
