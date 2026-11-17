// Placeholder Worker for tests: the test harness needs an entry point to host
// the local D1 database that server tests talk to from Node.
export default {
  fetch: () => new Response('d1 test host'),
} satisfies ExportedHandler;
