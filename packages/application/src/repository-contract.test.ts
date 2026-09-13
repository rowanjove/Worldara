import { InMemoryWorldRepository } from './memory-repository';
import { registerRepositoryContract } from './repository-contract';

registerRepositoryContract('memory', () => new InMemoryWorldRepository());
