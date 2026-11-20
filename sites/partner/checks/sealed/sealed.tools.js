// Spec check fixture: a coded tool whose published digest does not match.
export class Echo {
  invoke(args) {
    return { echoed: args };
  }
}
