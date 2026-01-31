# Global Development Preferences

## Code Style
- 2 space indentation
- Single quotes for strings
- Trailing commas
- Max line length: 100

## Commit Messages
- Format: "feat: description" or "fix: description"
- Types: feat, fix, docs, refactor, test, chore

## Error Handling
- Always use try/catch for async operations
- Log errors with context
- Graceful degradation for UI

## Security Rules
- Never commit secrets or .env files
- Always validate user inputs
- Use parameterized queries for databases
- HTTPS only in production
