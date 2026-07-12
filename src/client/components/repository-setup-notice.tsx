import { FileWarningIcon } from "lucide-react";

import { Button } from "./ui/button";

export function RepositorySetupNotice({
  configPath,
  onInitialize,
}: {
  configPath: string;
  onInitialize?: () => void;
}) {
  return (
    <div className="setup-needed" role="status">
      <FileWarningIcon />
      <div>
        <strong>This repository needs Workgrove setup</strong>
        <p>
          Review a detected starter configuration before Workgrove creates it,
          or add the file manually at this path.
        </p>
        <code>{configPath}</code>
        {onInitialize ? (
          <Button className="setup-button" onClick={onInitialize} size="sm">
            Review starter config
          </Button>
        ) : null}
      </div>
    </div>
  );
}
