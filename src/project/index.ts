/** Active-project seam — screens import the provider/hook from here. */
export {
  ActiveProjectProvider,
  useActiveProject,
  type ActiveProjectContextValue,
} from './ActiveProjectProvider';
export { resolveActiveProject } from './resolveActiveProject';
export {
  buildProjectOptions,
  UNSYNCED_PROJECT_NAME,
  type ProjectOption,
  type ProjectSummary,
} from './projectOptions';
