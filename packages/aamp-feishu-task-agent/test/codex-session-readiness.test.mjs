import {test} from 'node:test'
import assert from 'node:assert/strict'
import {codexSessionFailure} from '../bin/runtime-network.mjs'
test('Codex deferred initialization cannot be hidden by agent.started',()=>{
  const events=[{type:'agent.session.deferred',agent:'codex',message:'npm ENOENT'}, {type:'agent.started',agent:'codex'}]
  assert.match(codexSessionFailure(events),/npm ENOENT/)
  assert.equal(codexSessionFailure([...events,{type:'agent.session.ready',agent:'codex'}]),undefined)
  assert.match(codexSessionFailure([{type:'agent.session.deferred',agent:'aime'}]),/未收到/)
})
