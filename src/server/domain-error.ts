export class DomainError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'domain_error') {
    super(message);
    this.name = 'DomainError';
  }
}
