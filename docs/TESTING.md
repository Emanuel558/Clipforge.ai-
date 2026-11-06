# Phase 1 browser checklist

Start the app using README.md. Use a short MP4 with visible movement and audible speech or a tone. Begin with the generated demo for repeatable testing.

## Dashboard and upload

- Open Dashboard. Confirm an empty workspace shows a clear upload action.
- Open Upload video using the sidebar and the New project button.
- Select a non-MP4 file. Confirm a readable error appears.
- Upload an empty MP4. Confirm an error appears.
- Select a valid MP4. Confirm progress appears and reaches validation/preparation.
- During a sufficiently large upload, press Cancel upload. Confirm a cancellation message and a usable upload button.
- Drag and drop an MP4 onto the upload area. Confirm the same workflow works.
- Wait for preparation and the preview screen. Open Dashboard and confirm the new project thumbnail and information.

## Preview and trim

- Play the source. Check sound, picture and the native player seeking controls.
- Set start to 1 and end to 3 seconds. Preview selection. Confirm playback begins at 1 and stops near 3.
- Move the playhead, then use each Use playhead button. Confirm the corresponding field changes.
- Enter a negative start, an empty field, end before start, and an end beyond the source duration. Confirm an error and disabled export.
- Enter valid times again. Confirm export becomes available.
- Note: timestamps use seconds. Decimal values such as 1.5 are accepted. The timeline strip is a visual guide, rather than draggable trim handles.

## Export and recovery

- Press Export clip. Confirm queued/rendering progress appears. The button prevents a duplicate export while busy.
- Wait for completion. Download the clip and open the downloaded file in the browser or a video player.
- Confirm duration matches end minus start. Check the first and last visible moments. Listen for matching sound.
- Refresh the app and reopen the project. Confirm export history and the last submitted trim settings return.
- Export a second selection. Confirm both downloads remain available.
- While an export is running, restart the server. Reopen the project. Confirm the interrupted job displays an error and a new export succeeds.
- Disconnect the browser network during an upload. Reconnect and confirm another upload succeeds.

## Layout and cleanup

- Test at desktop and narrow phone-sized browser widths. Confirm the preview, time fields and download controls stay reachable.
- Use Tab and Enter to navigate buttons and inputs. Confirm visible focus indicators.
- Open deletion confirmation, then choose Keep project. Confirm no files disappear.
- Delete a completed project. Confirm the dashboard updates and its source and exports disappear from the server data folder.
- Confirm a processing project refuses deletion with a clear message.

## Verification recorded during development

Automated checks exercise the real media workflow, rather than mocked successful exports. Exact results are recorded in the pull request.

The managed browser preview initially failed before the app loaded because the environment could not enumerate network interfaces for Vite. Automated API/media tests and frontend compilation remain available. Complete this browser checklist in the private Codespace before treating interface QA as finished.
