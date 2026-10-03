import { withEnv } from '../../../test/env';
import { MissingEnvVarError } from '../../config/env';
import { EdgeService } from './edge.service';

describe('EdgeService', () => {
  let edgeService: EdgeService;

  beforeEach(() => {
    edgeService = new EdgeService();
  });

  describe('getCDNUrl', () => {
    it('returns the resource URL using EDGE_ENDPOINT', () => {
      withEnv({ EDGE_ENDPOINT: 'cdn.example.com' });

      const url = edgeService.getCDNUrl('file.txt');

      expect(url).toBe('https://cdn.example.com/file.txt');
    });

    it('encodes each path segment', () => {
      withEnv({ EDGE_ENDPOINT: 'cdn.example.com' });

      const url = edgeService.getCDNUrl('path with spaces/file #1.txt');

      expect(url).toBe('https://cdn.example.com/path%20with%20spaces/file%20%231.txt');
    });

    it('preserves an explicit protocol', () => {
      withEnv({ EDGE_ENDPOINT: 'http://cdn.example.com' });

      const url = edgeService.getCDNUrl('file.txt');

      expect(url).toBe('http://cdn.example.com/file.txt');
    });

    it('trims whitespace and trailing slashes from EDGE_ENDPOINT', () => {
      withEnv({ EDGE_ENDPOINT: '  cdn.example.com///  ' });

      const url = edgeService.getCDNUrl('nested/file.txt');

      expect(url).toBe('https://cdn.example.com/nested/file.txt');
    });

    it('throws MissingEnvVarError if EDGE_ENDPOINT is missing', () => {
      withEnv({ EDGE_ENDPOINT: undefined });

      expect(() => edgeService.getCDNUrl('file.txt')).toThrow(MissingEnvVarError);
    });
  });
});
