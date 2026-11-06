// Go to a project's city and follow its main agent once the robots are there (the tour's robot step,
// the mini window's rows; D26 A4). A session id picks that session's main agent when several work there.
import { useStore } from "../store.ts";
import { mainOf } from "../orchestrator/sessionAgents.ts";
import { mainRobot } from "./Robot.tsx";
import { robotInfo } from "./Robot.tsx";

/** follow the main agent as soon as it is drawn; `keepTrying` can stop the attempts (default 10 s) */
export function followMainWhenReady(sessionId?: string, keepTrying: () => boolean = () => true) {
  let n = 0;
  const attempt = () => {
    const mine = sessionId ? [`live|${mainOf(sessionId)}`, `live|${sessionId}`].find((id) => robotInfo.get(id)?.visible) : undefined;
    const id = mine ?? mainRobot();
    if (id) useStore.getState().setFollowAgent(id);
    else if (n++ < 40 && keepTrying()) setTimeout(attempt, 250);
  };
  attempt();
}

/** into a town's city (from space or another city), then follow its main agent */
export function goFollow(townKey: string, sessionId?: string) {
  const st = useStore.getState();
  st.select(null);
  if (st.city !== townKey) st.setCity(townKey);
  followMainWhenReady(sessionId);
}
