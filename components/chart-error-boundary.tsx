'use client';

import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export class ChartErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed)
      return (
        <div role="alert" className="error-message">
          <p>{this.props.title}暂时无法显示，其他行程数据不受影响。</p>
          <Button
            variant="outline"
            onClick={() => this.setState({ failed: false })}
          >
            重新加载图表
          </Button>
        </div>
      );
    return this.props.children;
  }
}
