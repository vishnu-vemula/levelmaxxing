import { Component, type PropsWithChildren } from 'react';
import { Action, Card, Mascot, Notice, Screen } from './ui.tsx';

export class AppErrorBoundary extends Component<PropsWithChildren, { interrupted: boolean }> {
  state = { interrupted: false };
  static getDerivedStateFromError() { return { interrupted: true }; }

  render() {
    if (!this.state.interrupted) return this.props.children;
    return <Screen title="Something went wrong">
      <Card tone="primary">
        <Mascot />
        <Notice kind="error">Levelmaxing could not open this screen.</Notice>
        <Action title="Try again" onPress={() => this.setState({ interrupted: false })} />
      </Card>
    </Screen>;
  }
}
