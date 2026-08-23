import { useCallback, useEffect, useState } from 'react';
import { fetchCapabilities, fetchProjects, ApiError } from './api/client.ts';
import type { CapabilitiesResponse, Project } from './api/types.ts';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { NewProjectPage } from './pages/NewProjectPage.tsx';
import { ProjectPage } from './pages/ProjectPage.tsx';

type Route =
  | { name: 'dashboard' }
  | { name: 'new' }
  | { name: 'project'; id: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'dashboard' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await fetchProjects());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
    void fetchCapabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities(null));
  }, [loadProjects]);

  // Refresh the list whenever we return to the dashboard.
  useEffect(() => {
    if (route.name === 'dashboard') void loadProjects();
  }, [route, loadProjects]);

  const goDashboard = useCallback(() => setRoute({ name: 'dashboard' }), []);

  return (
    <div className="app">
      {route.name === 'dashboard' && (
        <DashboardPage
          projects={projects}
          capabilities={capabilities}
          loading={loading}
          error={error}
          onNewProject={() => setRoute({ name: 'new' })}
          onOpenProject={(id) => setRoute({ name: 'project', id })}
        />
      )}

      {route.name === 'new' && (
        <NewProjectPage
          onBack={goDashboard}
          ffmpegAvailable={capabilities?.ffmpeg.available ?? true}
          onCreated={(project) => setRoute({ name: 'project', id: project.id })}
        />
      )}

      {route.name === 'project' && (
        <ProjectPage projectId={route.id} onBack={goDashboard} onDeleted={goDashboard} />
      )}
    </div>
  );
}
