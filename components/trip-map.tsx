'use client';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DetailHelp } from '@/components/detail-help';
import { api, type Connection } from '@/lib/api';
type Frame = {
  image: string;
  width: number;
  height: number;
  path: string;
  start: number[];
  end: number[];
  zoom: number;
  pointCount: number;
};
export function TripMap({
  connection,
  carId,
  driveId,
}: {
  connection: Connection;
  carId: number;
  driveId: number;
}) {
  const clipId = useId();
  const [focus, setFocus] = useState('route');
  const [zoom, setZoom] = useState(0);
  const query = useQuery({
    queryKey: ['trip-map', connection.session, carId, driveId, focus, zoom],
    queryFn: ({ signal }) =>
      api<Frame>(
        connection,
        `/cars/${carId}/drives/${driveId}/map?focus=${focus}&zoom=${zoom}`,
        signal,
      ),
    retry: false,
    staleTime: 300000,
    gcTime: 300000,
  });
  const frame = query.data;
  return (
    <section className="trip-map" aria-label="高德行程地图">
      <div className="trip-map-toolbar">
        <h3 className="detail-module-title">
          行程地图
          <DetailHelp title="行程地图">
            高德地图底图，蓝点为起点、深色点为终点，北向上。轨迹按本次行程采样在本地转换到高德坐标系后叠加，不修改原始坐标，也不是导航规划路线。支持全程、起点、终点和缩放，暂不支持拖动平移。
          </DetailHelp>
        </h3>
        <div>
          <Button
            variant="outline"
            size="icon"
            aria-label="缩小地图"
            disabled={
              query.isFetching || zoom <= -2 || (frame?.zoom ?? 17) <= 3
            }
            onClick={() => setZoom((z) => z - 1)}
          >
            <Minus size={18} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="放大地图"
            disabled={query.isFetching || zoom >= 4 || (frame?.zoom ?? 3) >= 17}
            onClick={() => setZoom((z) => z + 1)}
          >
            <Plus size={18} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="显示完整行程"
            disabled={query.isFetching}
            onClick={() => {
              setFocus('route');
              setZoom(0);
            }}
          >
            <RotateCcw size={17} />
          </Button>
        </div>
      </div>
      <div className="trip-map-canvas" aria-busy={query.isFetching}>
        {query.isPending ? (
          <Skeleton className="h-full w-full" />
        ) : query.isError ? (
          <div className="trip-map-error" role="alert">
            <p>{query.error.message}</p>
            <Button variant="outline" onClick={() => query.refetch()}>
              重新加载地图
            </Button>
          </div>
        ) : (
          frame && (
            <>
              {/* oxlint-disable-next-line next/no-img-element -- Private data URL; no public image optimizer or Next server exists in the native build. */}
              <img
                src={frame.image}
                alt="高德街道地图底图"
                width={frame.width}
                height={frame.height}
                draggable={false}
              />
              <svg
                viewBox={`0 0 ${frame.width} ${frame.height}`}
                aria-label="实际行程轨迹，蓝色为起点，深色为终点"
              >
                <defs>
                  <clipPath id={clipId}>
                    <rect
                      x="0"
                      y="0"
                      width={frame.width}
                      height={frame.height - 32}
                    />
                  </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`}>
                  <polyline
                    points={frame.path}
                    fill="none"
                    stroke="white"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={frame.path}
                    fill="none"
                    stroke="#006fe6"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx={frame.start[0]}
                    cy={frame.start[1]}
                    r="7"
                    fill="#006fe6"
                    stroke="white"
                    strokeWidth="3"
                  />
                  <circle
                    cx={frame.end[0]}
                    cy={frame.end[1]}
                    r="7"
                    fill="#172c42"
                    stroke="white"
                    strokeWidth="3"
                  />
                </g>
              </svg>
            </>
          )
        )}
      </div>
      <div className="trip-map-locations">
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            setFocus('start');
            setZoom(0);
          }}
        >
          查看起点
        </Button>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            setFocus('end');
            setZoom(0);
          }}
        >
          查看终点
        </Button>
      </div>
    </section>
  );
}
