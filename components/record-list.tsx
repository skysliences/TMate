'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DriveRow, ChargeRow, NoData, SectionTitle } from './data-views';
import { api, type Connection } from '@/lib/api';
import { summarize, type Dashboard, type Drive, type Charge } from '@/lib/data';
import type { Detail } from './record-detail';
export function RecordList({
  kind,
  data,
  days,
  connection,
  currency,
  electricityPrice,
  onDetail,
}: {
  kind: 'drives' | 'charges';
  data: Dashboard;
  days: number;
  connection: Connection | null;
  currency: string;
  electricityPrice: number | null;
  onDetail: (d: Detail) => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ['records', connection?.session, data.car.id, kind, days],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      if (connection)
        return api<{
          items: (Drive | Charge)[];
          hasMore: boolean;
          nextOffset: number;
        }>(
          connection,
          `/cars/${data.car.id}/${kind}?days=${days}&offset=${pageParam}&limit=30`,
          signal,
        );
      const since = summarize(data, days).since;
      const items = data[kind].filter((d) => new Date(d.date) >= since);
      return {
        items: items.slice(pageParam, pageParam + 30),
        hasMore: items.length > pageParam + 30,
        nextOffset: pageParam + 30,
      };
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextOffset : undefined),
    retry: false,
    staleTime: 60000,
  });
  const items = query.data?.pages.flatMap((page) => page.items) || [];
  return (
    <section className="panel records-panel">
      <SectionTitle title={kind === 'drives' ? '行程记录' : '充电记录'} />
      <p className="subtle records-note">
        最近 {days} 天 · {kind === 'drives' ? '已完成的行程' : '已完成的充电'} ·
        点击记录查看详情
      </p>
      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.isError ? (
        <p role="alert" className="error-message">
          {query.error.message}
          <Button variant="outline" onClick={() => query.refetch()}>
            重试
          </Button>
        </p>
      ) : items.length ? (
        items.map((record) =>
          kind === 'drives' ? (
            <DriveRow
              key={record.id}
              drive={record as Drive}
              onClick={() =>
                onDetail({ type: 'drive', record: record as Drive })
              }
            />
          ) : (
            <ChargeRow
              electricityPrice={electricityPrice}
              key={record.id}
              charge={record as Charge}
              currency={currency}
              onClick={() =>
                onDetail({ type: 'charge', record: record as Charge })
              }
            />
          ),
        )
      ) : (
        <NoData />
      )}
      {query.hasNextPage && (
        <Button
          className="load-more"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? '正在加载…' : '加载更多记录'}
        </Button>
      )}
    </section>
  );
}
