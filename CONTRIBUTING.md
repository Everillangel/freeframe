# Contributing to FreeFrame

Thanks for your interest in contributing to FreeFrame! This guide will help you get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/freeframe.git`
3. **Create a branch**: `git checkout -b feat/my-feature`
4. **Start dev environment**: `docker compose -f docker-compose.dev.yml up -d`
5. **Run migrations**: `docker compose -f docker-compose.dev.yml exec -w /workspace/apps/api api alembic upgrade head`

## Development Setup

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ with pnpm
- Python 3.11+

### Services
| Service | Port | Description |
|---------|------|-------------|
| web | 3000 | Next.js frontend |
| api | 8000 | FastAPI backend |
| postgres | 5432 | PostgreSQL 15 |
| redis | 6379 | Redis 7 |
| minio | 9000/9001 | S3-compatible storage |

### Running Tests

```bash
# Backend tests
python -m pytest apps/api/tests/ -v

# Frontend build check
cd apps/web && pnpm install && pnpm build
```

## Pull Request Process

1. **Keep PRs focused** — one feature or fix per PR
2. **Write tests** for new backend functionality
3. **Ensure CI passes** — tests + build must be green
4. **Update documentation** if you change APIs or configuration
5. **Follow existing patterns** — match the code style of surrounding code

### Commit Messages

Use conventional commits:
```
feat: add new share link type
fix: resolve 403 on password-protected shares
docs: update API endpoint documentation
ci: add frontend lint job
```

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser/OS details
- Screenshots if applicable

## Feature Requests

Open an issue describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

## Code of Conduct

Be respectful and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
