Kiya Agent runtime resources

Runtime target: windows-x64

Optional vendor inputs:
  vendor/runtime/windows-x64/*
  vendor/runtime/darwin-arm64/*
  vendor/runtime/darwin-x64/*
  vendor/runtime/linux-x64/*

Recommended per-target layout:
  <target>/aria2c(.exe)
  <target>/node(.exe)
  <target>/npm(.cmd)
  <target>/npx(.cmd)
  <target>/node_modules/*

Generated files:
  local-mcp.js
  mock-aria2-rpc.mjs
  runtime-manifest.json
  pi-runtime/node_modules/*